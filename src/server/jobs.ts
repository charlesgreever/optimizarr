import { randomUUID } from "node:crypto";
import { access, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Store } from "./store.ts";
import type { HardwareInfo, Job, ReviewItem, Settings, Suggestion } from "./types.ts";
import { displayTitle } from "./titles.ts";
import type { Optimizer } from "./optimize.ts";
import { CancelledError, isExecutablePlan, planFromSuggestion, resolvePlan } from "./optimize.ts";
import { exceedsSizeCap } from "./size-budget.ts";
import { classifyInterruptedKeep, KEEP_INTERRUPTED, SIDECAR_GONE } from "./review-recovery.ts";
import { promote, promotedPath, type PromoteInput, type PromoteResult } from "./promote.ts";
import { assignProfile, PROFILE_NAMES } from "./arr-profiles.ts";
import { profileAssignmentEligible } from "./types.ts";

export type JobServiceOptions = {
  store: Store;
  optimizer: Optimizer;
  clock?: () => number;
  hardware: () => Promise<HardwareInfo>;
  tools: { ffmpeg: string; ffprobe: string; mkvmerge: string };
  decrypt: (packed: string) => string;
  fetch: typeof fetch;
  reinspectChangedItem: (itemId: string, oldPath: string) => Promise<{ ok: true } | { ok: false; warning: string }>;
  promote?: (input: PromoteInput) => Promise<PromoteResult>;
};

export class JobService {
  private running = new Set<string>();
  private cancelled = new Set<string>();
  private keepRunning = 0;
  private keepWaiters: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: JobServiceOptions) {}

  start(): void {
    this.opts.store.recoverInterruptedJobs();
    void this.recoverInterruptedKeeps();
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
    const writeMode = this.opts.store.getSettings().writeMode;
    const plan = planFromSuggestion(suggestion, writeMode);
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
      writeMode,
      plan,
    });
    void this.tick();
    return { id };
  }

  enqueueCustom(itemId: string, plan: import("./types.ts").ExecutablePlan, runNow = false): { id: string } | { error: string; status: number } {
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
      suggestionId: null,
      status: "queued",
      phase: "queued",
      progress: 0,
      error: null,
      warning: plan.warning,
      runNow,
      createdAt: this.now(),
      writeMode: plan.writeMode,
      promoteError: null,
      plan,
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

  cancelAll(): { cancelled: number } {
    const ids = this.opts.store.cancelActiveJobs(this.now());
    for (const id of ids) this.cancelled.add(id);
    return { cancelled: ids.length };
  }

  remove(id: string): { ok: true } | { error: string; status: number } {
    const result = this.opts.store.removeFinishedJob(id);
    if (result === "missing") return { error: "That job does not exist.", status: 404 };
    if (result === "active") return { error: "Cancel this job before removing it from Queue.", status: 409 };
    return { ok: true };
  }

  clearFinished(): { removed: number } {
    return { removed: this.opts.store.clearFinishedJobs() };
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
      const plan = resolvePlan(job.plan, job.writeMode);
      const result = await this.opts.optimizer({
        sourcePath: item.path,
        reviewDir: settings.reviewPath,
        suggestion: isExecutablePlan(job.plan) ? undefined : job.plan,
        plan,
        report,
        target: settings.videoTarget,
        backend: hardware.backend,
        vaapiDevice: hardware.vaapiDevice,
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
      if (plan.writeMode === "direct") {
        const outcome = await this.promoteOutput(item, result.sidecarPath, report.sizeBytes, result.output.sizeBytes, plan);
        if (!outcome.replaced) {
          this.opts.store.updateJob(id, { status: "failed", error: outcome.error ?? "Direct write failed." });
          this.opts.store.addHistory(item.id, "failed", 0, this.now());
          return;
        }
        this.opts.store.updateItemFile(item.id, outcome.destPath, result.output.sizeBytes);
        const reinspection = await this.opts.reinspectChangedItem(item.id, item.path);
        const warning = appendWarning(outcome.warning, reinspection.ok ? null : `The new file could not be inspected: ${reinspection.warning}`);
        this.opts.store.updateJob(id, { status: "succeeded", phase: "idle", progress: 1, promoteError: warning });
        this.opts.store.addHistory(item.id, "kept", outcome.savedBytes, this.now());
        return;
      }
      const overCap = exceedsSizeCap(result.output.sizePerHourGb, settings.sizeCaps[plan.category]);
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

  async recoverInterruptedKeeps(): Promise<void> {
    for (const review of this.opts.store.listReviews()) {
      if (review.status === "discarding") {
        try {
          await unlink(review.sidecarPath);
        } catch {
          // Sidecar may already be gone.
        }
        this.opts.store.deleteReview(review.id);
        this.opts.store.addHistory(review.itemId, "discarded", 0, this.now());
        continue;
      }
      if (review.status !== "keeping") continue;
      const item = this.opts.store.getItem(review.itemId);
      const job = this.opts.store.getJob(review.jobId);
      const plan = job ? resolvePlan(job.plan, job.writeMode) : undefined;
      const destPath = item ? promotedPath(item.path, plan) : review.sourcePath;
      const destBytes = await fileSize(destPath);
      const sourceBytesOnDisk = destPath === review.sourcePath ? destBytes : await fileSize(review.sourcePath);
      const kind = classifyInterruptedKeep({
        sidecarExists: await fileExists(review.sidecarPath),
        libraryBytes: destBytes ?? sourceBytesOnDisk,
        sourceBytes: review.source.sizeBytes ?? 0,
        sidecarBytes: review.sidecar.sizeBytes ?? 0,
      });
      if (kind === "complete") {
        await this.finalizeCompletedKeep(review, destPath);
        continue;
      }
      if (kind === "sidecar_gone") {
        this.opts.store.updateReview(review.id, { status: "pending", error: SIDECAR_GONE });
        continue;
      }
      await cleanupStagedPromoteFiles(review.sourcePath);
      if (destPath !== review.sourcePath) await cleanupStagedPromoteFiles(destPath);
      this.opts.store.updateReview(review.id, { status: "pending", error: KEEP_INTERRUPTED });
    }
  }

  async keep(reviewId: string): Promise<{ accepted: true } | { error: string; status: number }> {
    const review = this.opts.store.getReview(reviewId);
    if (!review) return { error: "That review item is gone.", status: 404 };
    if (review.status === "keeping") return { error: "Keep is already running for this title.", status: 409 };
    if (!(await fileExists(review.sidecarPath))) {
      this.opts.store.updateReview(reviewId, { status: "pending", error: SIDECAR_GONE });
      return { error: SIDECAR_GONE, status: 409 };
    }
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
    if (!(await fileExists(review.sidecarPath))) {
      this.opts.store.updateReview(reviewId, { status: "pending", error: SIDECAR_GONE });
      return;
    }
    const job = this.opts.store.getJob(review.jobId);
    const plan = job ? resolvePlan(job.plan, job.writeMode) : undefined;
    const outcome = await this.withKeepSlot(() =>
      this.promoteOutput(item, review.sidecarPath, review.source.sizeBytes ?? 0, review.sidecar.sizeBytes ?? 0, plan),
    );
    if (!outcome.replaced) {
      this.opts.store.updateReview(reviewId, { status: "pending", error: outcome.error });
      return;
    }
    this.opts.store.addHistory(item.id, "kept", outcome.savedBytes, this.now());
    this.opts.store.updateItemFile(item.id, outcome.destPath, review.sidecar.sizeBytes ?? item.sizeBytes);
    const reinspection = await this.opts.reinspectChangedItem(item.id, item.path);
    this.opts.store.deleteReview(reviewId);
    const warning = appendWarning(outcome.warning, reinspection.ok ? null : `The new file could not be inspected: ${reinspection.warning}`);
    if (warning && job) this.opts.store.updateJob(job.id, { promoteError: warning });
  }

  private async finalizeCompletedKeep(review: ReviewItem, destPath: string): Promise<void> {
    try {
      await unlink(review.sidecarPath);
    } catch {
      // Sidecar may already have been removed after a successful replace.
    }
    const saved = Math.max(0, (review.source.sizeBytes ?? 0) - (review.sidecar.sizeBytes ?? 0));
    this.opts.store.addHistory(review.itemId, "kept", saved, this.now());
    this.opts.store.updateItemFile(review.itemId, destPath, review.sidecar.sizeBytes ?? 0);
    await this.opts.reinspectChangedItem(review.itemId, review.sourcePath);
    this.opts.store.deleteReview(review.id);
  }

  private async withKeepSlot<T>(work: () => Promise<T>): Promise<T> {
    const capacity = Math.max(1, this.opts.store.getSettings().concurrency);
    while (this.keepRunning >= capacity) {
      await new Promise<void>((resolve) => this.keepWaiters.push(resolve));
    }
    this.keepRunning += 1;
    try {
      return await work();
    } finally {
      this.keepRunning -= 1;
      this.keepWaiters.shift()?.();
    }
  }

  private async promoteOutput(
    item: NonNullable<ReturnType<Store["getItem"]>>,
    outputPath: string,
    sourceSize: number,
    outputSize: number,
    plan: ReturnType<typeof resolvePlan> | undefined,
  ) {
    const instance = this.opts.store.getInstance(item.instanceId);
    const players = this.opts.store
      .listInstances()
      .map((p) => this.opts.store.getInstance(p.id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.enabled && p.secret && (p.kind === "plex" || p.kind === "jellyfin")))
      .map((p) => ({
        kind: p.kind as "plex" | "jellyfin",
        url: p.url,
        token: this.opts.decrypt(p.secret ?? ""),
      }));
    const promoteFn = this.opts.promote ?? promote;
    const outcome = await promoteFn({
      item,
      outputPath,
      sourceSize,
      outputSize,
      plan,
      decrypt: this.opts.decrypt,
      fetch: this.opts.fetch,
      instance,
      players,
    });
    if (
      outcome.replaced &&
      plan &&
      profileAssignmentEligible({
        autoAssign: this.opts.store.getSettings().profileAutoAssign,
        sizeExempt: item.sizeExempt,
        plan,
      }) &&
      instance?.secret &&
      (instance.kind === "radarr" || instance.kind === "sonarr")
    ) {
      const extra = await assignProfile({
        kind: instance.kind,
        url: instance.url,
        apiKey: this.opts.decrypt(instance.secret),
        movieId: instance.kind === "radarr" ? item.arrId : undefined,
        seriesId: instance.kind === "sonarr" ? (item.arrSeriesId ?? undefined) : undefined,
        profileName: PROFILE_NAMES[plan.category],
        currentQuality: item.quality,
        fetch: this.opts.fetch,
      });
      if (extra) outcome.warning = outcome.warning ? `${outcome.warning} ${extra}` : extra;
    }
    return outcome;
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function cleanupStagedPromoteFiles(libraryPath: string): Promise<void> {
  const dir = dirname(libraryPath);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(names
    .filter((name) => name.endsWith(".opt-new") || name.endsWith(".opt-old"))
    .map((name) => unlink(join(dir, name)).catch(() => undefined)));
}

function appendWarning(current: string | null, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  return `${current} ${next}`;
}
