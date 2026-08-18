import { randomUUID } from "node:crypto";
import { rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Store } from "./store.ts";
import type { HardwareInfo, Job, Settings, Suggestion } from "./types.ts";
import { displayTitle } from "./titles.ts";
import type { Optimizer } from "./optimize.ts";
import { CancelledError } from "./optimize.ts";
import { notifyPlayers, refreshArr } from "./notify.ts";

export type JobServiceOptions = {
  store: Store;
  optimizer: Optimizer;
  clock?: () => number;
  hardware: () => Promise<HardwareInfo>;
  tools: { ffmpeg: string; ffprobe: string; mkvmerge: string };
  decrypt: (packed: string) => string;
  fetch: typeof fetch;
};

export class JobService {
  private running = new Set<string>();
  private cancelled = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: JobServiceOptions) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  enqueue(itemId: string, suggestion: Suggestion, runNow = false): { id: string } | { error: string; status: number } {
    const item = this.opts.store.getItem(itemId);
    if (!item) return { error: "That title is not in the library.", status: 404 };
    if (this.opts.store.pendingReviewForItem(itemId)) {
      return { error: "This title already has a sidecar waiting in Review.", status: 409 };
    }
    if (this.opts.store.activeJobForItem(itemId)) {
      return { error: "This title already has an active job.", status: 409 };
    }
    const id = randomUUID();
    this.opts.store.insertJob({
      id,
      itemId,
      suggestionId: suggestion.id,
      status: "queued",
      phase: "queued",
      progress: 0,
      error: null,
      warning: suggestion.warning,
      runNow,
      createdAt: this.now(),
      plan: suggestion,
    });
    void this.tick();
    return { id };
  }

  cancel(id: string): { ok: true } | { error: string; status: number } {
    const job = this.opts.store.getJob(id);
    if (!job) return { error: "That job does not exist.", status: 404 };
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return { error: "Finished jobs cannot be cancelled.", status: 409 };
    }
    this.cancelled.add(id);
    this.opts.store.updateJob(id, { status: "cancelled", phase: "idle", error: "Cancelled." });
    this.opts.store.addHistory(job.itemId, "cancelled", 0, this.now());
    return { ok: true };
  }

  private async tick(): Promise<void> {
    try {
      const settings = this.opts.store.getSettings();
      this.applySchedule(settings);
      const capacity = Math.max(1, settings.concurrency) - this.running.size;
      if (capacity <= 0) return;
      const next = this.opts.store
        .listJobs()
        .filter((j) => j.status === "queued")
        .slice(0, capacity);
      for (const job of next) void this.run(job.id, settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`The job runner skipped a tick because ${message}`);
    }
  }

  private applySchedule(settings: Settings): void {
    if (!settings.offPeakEnabled) return;
    const inWindow = insideWindow(settings.offPeakStart, settings.offPeakEnd, new Date(this.now()));
    for (const job of this.opts.store.listJobs()) {
      if (job.status === "queued" && !inWindow && !job.runNow) {
        this.opts.store.updateJob(job.id, { status: "held", phase: "held" });
      }
      if (job.status === "held" && (inWindow || job.runNow)) {
        this.opts.store.updateJob(job.id, { status: "queued", phase: "queued" });
      }
    }
  }

  private async run(id: string, settings: Settings): Promise<void> {
    if (this.running.has(id) || this.cancelled.has(id)) return;
    const job = this.opts.store.getJob(id);
    if (!job) return;
    const item = this.opts.store.getItem(job.itemId);
    const report = this.opts.store.getInspection(job.itemId);
    if (!item || !report) {
      this.opts.store.updateJob(id, { status: "failed", error: "This title has no completed inspection." });
      return;
    }
    this.running.add(id);
    this.opts.store.updateJob(id, { status: "running", phase: "muxing", progress: 0.05 });
    try {
      const hardware = await this.opts.hardware();
      const result = await this.opts.optimizer({
        sourcePath: item.path,
        reviewDir: settings.reviewPath,
        suggestion: job.plan,
        report,
        target: settings.videoTarget,
        backend: hardware.backend,
        ffmpeg: this.opts.tools.ffmpeg,
        ffprobe: this.opts.tools.ffprobe,
        mkvmerge: this.opts.tools.mkvmerge,
        conservative: settings.conservativeMode,
        onPhase: (phase, progress) => {
          if (!this.cancelled.has(id)) this.opts.store.updateJob(id, { phase, progress });
        },
        isCancelled: () => this.cancelled.has(id),
      });
      if (this.cancelled.has(id)) {
        await safeUnlink(result.sidecarPath);
        return;
      }
      const overCap = result.output.sizePerHourGb > settings.sizeCaps[job.plan.category];
      const larger = result.output.sizeBytes > report.sizeBytes;
      this.opts.store.insertReview({
        id: randomUUID(),
        jobId: id,
        itemId: item.id,
        displayTitle: displayTitle(item),
        status: "pending",
        flagged: overCap || larger,
        flagReason: overCap || larger ? "The sidecar missed the size target or is larger than the original." : null,
        sourcePath: item.path,
        sidecarPath: result.sidecarPath,
        source: {
          codec: report.videoCodec,
          quality: item.quality,
          sizeBytes: report.sizeBytes,
          sizePerHourGb: report.sizePerHourGb,
          durationSec: report.durationSec,
          tracks: `${report.audio.length} audio / ${report.subtitles.length} subtitles`,
        },
        sidecar: {
          codec: result.output.videoCodec,
          quality: item.quality,
          sizeBytes: result.output.sizeBytes,
          sizePerHourGb: result.output.sizePerHourGb,
          durationSec: result.output.durationSec,
          tracks: `${result.output.audio.length} audio / ${result.output.subtitles.length} subtitles`,
        },
        error: null,
      });
      this.opts.store.updateJob(id, { status: "succeeded", phase: "idle", progress: 1 });
      if (overCap || larger) this.opts.store.addHistory(item.id, "flagged", 0, this.now());
    } catch (error) {
      if (error instanceof CancelledError || this.cancelled.has(id)) {
        this.opts.store.updateJob(id, { status: "cancelled", error: "Cancelled." });
      } else {
        const message = error instanceof Error ? error.message : "The job failed.";
        this.opts.store.updateJob(id, { status: "failed", error: message });
        this.opts.store.addHistory(item.id, "failed", 0, this.now());
      }
    } finally {
      this.running.delete(id);
    }
  }

  async keep(reviewId: string): Promise<{ accepted: true } | { error: string; status: number }> {
    const review = this.opts.store.getReview(reviewId);
    if (!review) return { error: "That review item is gone.", status: 404 };
    if (review.status === "keeping") return { error: "Keep is already running for this title.", status: 409 };
    this.opts.store.updateReview(reviewId, { status: "keeping" });
    void this.performKeep(reviewId);
    return { accepted: true };
  }

  private async performKeep(reviewId: string): Promise<void> {
    const review = this.opts.store.getReview(reviewId);
    if (!review) return;
    const item = this.opts.store.getItem(review.itemId);
    if (!item) {
      this.opts.store.updateReview(reviewId, { status: "pending", error: "The library row disappeared." });
      return;
    }
    try {
      await rename(review.sidecarPath, item.path);
    } catch {
      try {
        const { copyFile } = await import("node:fs/promises");
        await copyFile(review.sidecarPath, item.path);
        await unlink(review.sidecarPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Keep could not replace the library file.";
        this.opts.store.updateReview(reviewId, { status: "pending", error: message });
        return;
      }
    }
    const saved = Math.max(0, review.source.sizeBytes ?? 0) - Math.max(0, review.sidecar.sizeBytes ?? 0);
    this.opts.store.addHistory(item.id, "kept", saved, this.now());
    this.opts.store.deleteReview(reviewId);
    const instance = this.opts.store.getInstance(item.instanceId);
    if (instance?.secret && (instance.kind === "radarr" || instance.kind === "sonarr")) {
      const msg = await refreshArr(instance.kind, instance.url, this.opts.decrypt(instance.secret), item.arrId, this.opts.fetch);
      if (msg) this.opts.store.addHistory(item.id, "failed", 0, this.now());
    }
    const players = this.opts.store
      .listInstances()
      .filter((p) => (p.kind === "plex" || p.kind === "jellyfin") && "enabled" in p);
    const enabled = this.opts.store.listInstances().filter((p) => p.kind === "plex" || p.kind === "jellyfin");
    const list = enabled
      .map((p) => this.opts.store.getInstance(p.id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.enabled && p.secret));
    await notifyPlayers(
      list.map((p) => ({
        kind: p.kind as "plex" | "jellyfin",
        url: p.url,
        token: this.opts.decrypt(p.secret ?? ""),
      })),
      this.opts.fetch,
    );
    void dirname;
    void players;
  }

  async discard(reviewId: string): Promise<{ accepted: true } | { error: string; status: number }> {
    const review = this.opts.store.getReview(reviewId);
    if (!review) return { error: "That review item is gone.", status: 404 };
    this.opts.store.updateReview(reviewId, { status: "discarding" });
    try {
      await unlink(review.sidecarPath);
    } catch {
      // The sidecar may already be gone.
    }
    this.opts.store.deleteReview(reviewId);
    this.opts.store.addHistory(review.itemId, "discarded", 0, this.now());
    return { accepted: true };
  }

  decorate(job: Job): Job {
    const item = this.opts.store.getItem(job.itemId);
    return { ...job, displayTitle: item ? displayTitle(item) : job.itemId };
  }

  private now(): number {
    return this.opts.clock?.() ?? Date.now();
  }
}

export function insideWindow(start: string, end: string, now: Date): boolean {
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s <= e) return cur >= s && cur < e;
  return cur >= s || cur < e;
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Partial output may not exist.
  }
}

export function withTitles(jobs: Job[], store: Store): Job[] {
  return jobs.map((job) => {
    const item = store.getItem(job.itemId);
    return { ...job, displayTitle: item ? displayTitle(item) : job.itemId };
  });
}
