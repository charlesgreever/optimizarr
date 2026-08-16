import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { InspectionReport } from "./inspect.ts";
import { notifyArrRename, notifyPlayer } from "./notify.ts";
import { assertHardware, detectBackends, type EncodeBackends } from "./hardware.ts";
import { IntegrityError, reviewPathFor, type Optimizer } from "./optimize.ts";
import { createStorage, storageConfigFromSettings, type Transfer } from "./storage.ts";
import type { SuggestionPlan } from "./suggest.ts";
import type { Store } from "./store.ts";
import type { FetchLike } from "./arr.ts";
import { sizePerHourGb } from "./inspect.ts";
import type { Settings } from "./types.ts";

export class JobService {
  constructor(
    private store: Store,
    private optimize: Optimizer,
    private fetchImpl: FetchLike = fetch,
    private fs: {
      rename: typeof rename;
      unlink: typeof unlink;
      mkdir: typeof mkdir;
      stat: typeof stat;
    } = { rename, unlink, mkdir, stat },
    public backends: EncodeBackends = detectBackends(),
    public now: () => Date = () => new Date(),
    private transferFor: (settings: Settings) => Transfer = (settings) =>
      createStorage(storageConfigFromSettings(settings)),
  ) {}

  async enqueue(suggestionId: number): Promise<{ jobId: number } | { error: string; status: number }> {
    const suggestion = this.store.getSuggestion(suggestionId);
    if (!suggestion) return { error: "Suggestion not found", status: 404 };
    const item = this.store.getLibraryItem(suggestion.itemId);
    if (!item) return { error: "Library item not found", status: 404 };
    if (this.store.pendingReviewForItem(item.id)) {
      return { error: "A sidecar is already pending review for this title", status: 409 };
    }
    const settings = this.store.getSettings();
    if (!settings.reviewPath) return { error: "Set a review path in Settings first", status: 400 };
    try {
      await this.fs.mkdir(settings.reviewPath, { recursive: true });
      const { statfs } = await import("node:fs/promises");
      const disk = await statfs(settings.reviewPath);
      const free = Number(disk.bavail) * Number(disk.bsize);
      if (item.size && free < item.size) {
        return { error: "Not enough disk space on the review path", status: 400 };
      }
    } catch (err) {
      if (err && typeof err === "object" && "status" in err) throw err;
    }
    const jobId = this.store.createJob(item.id, suggestion.id, suggestion.plan, this.now().toISOString());
    await this.processQueue();
    return { jobId };
  }

  async processQueue(): Promise<void> {
    const settings = this.store.getSettings();
    const jobs = this.store.listJobs();
    const running = jobs.filter((j) => j.status === "running").length;
    let slots = Math.max(0, settings.concurrency - running);
    const inWindow = !settings.offPeakEnabled || inOffPeak(settings.offPeakStart, settings.offPeakEnd, this.now());
    for (const job of [...jobs].reverse()) {
      if (slots <= 0) break;
      if (job.status !== "queued" && job.status !== "held") continue;
      const runNow = Boolean((this.store.getJob(job.id as number) as { runNow?: boolean } | undefined)?.runNow);
      if (!inWindow && !runNow) {
        this.store.updateJob(job.id as number, { status: "held" });
        continue;
      }
      slots -= 1;
      await this.runJob(job.id as number);
    }
  }

  cancel(jobId: number): void {
    const job = this.store.getJob(jobId);
    if (!job || job.status === "succeeded") return;
    this.store.updateJob(jobId, { status: "cancelled", finishedAt: this.now().toISOString() });
  }

  async runJob(jobId: number): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job) return;
    const item = this.store.getLibraryItem(job.itemId as number);
    if (!item) return;
    const settings = this.store.getSettings();
    const report = this.store.getInspection(item.id) as InspectionReport | undefined;
    const livePlan = JSON.parse(String(job.planJson ?? "{}")) as SuggestionPlan;
    const sidecarPath = reviewPathFor(settings.reviewPath, item.title, item.id);
    this.store.updateJob(jobId, { status: "running", startedAt: new Date().toISOString(), progress: 0.1 });
    try {
      if (!report) throw new Error("No inspection report");
      if (livePlan.actions?.includes("transcode") || livePlan.actions?.includes("add_stereo") === false) {
        /* hardware checked only for transcode */
      }
      if (livePlan.actions?.includes("transcode")) {
        const codec = settings.targetCodec === "av1" && this.backends.av1 ? "av1" : "hevc";
        assertHardware(this.backends, codec);
      }
      const result = await this.optimize({
        sourcePath: item.path,
        sidecarPath,
        plan: livePlan,
        report,
        transfer: this.transferFor(settings),
      });
      const outHour = sizePerHourGb({ sizeBytes: result.sizeBytes, durationSec: result.durationSec });
      const cap = settings.sizeCapsGbPerHour[livePlan.category] ?? settings.sizeCapsGbPerHour.movie1080p;
      const flagged =
        result.sizeBytes > report.sizeBytes || (outHour !== null && livePlan.category && outHour > cap);
      this.store.createReview({
        itemId: item.id,
        jobId,
        sourcePath: item.path,
        sidecarPath: result.sidecarPath,
        compare: {
          source: { size: report.sizeBytes, duration: report.durationSec, codec: report.videoCodec },
          sidecar: { size: result.sizeBytes, duration: result.durationSec, path: result.sidecarPath },
        },
        flagged,
      });
      this.store.updateJob(jobId, { status: "succeeded", progress: 1, finishedAt: new Date().toISOString() });
      this.store.addHistory(item.id, item.title, flagged ? "flagged" : "finished");
    } catch (err) {
      const message = err instanceof IntegrityError || err instanceof Error ? err.message : "Job failed";
      await this.fs.unlink(`${sidecarPath}.tmp`).catch(() => undefined);
      this.store.updateJob(jobId, {
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      });
      this.store.addHistory(item.id, item.title, "failed", message);
    }
  }

  async keep(
    reviewId: number,
  ): Promise<{ ok: boolean; notify: { target: string; ok: boolean; error?: string }[]; error?: string }> {
    const review = this.store.getReview(reviewId);
    if (!review || review.status !== "pending") return { ok: false, notify: [], error: "Review not found" };
    const item = this.store.getLibraryItem(review.itemId);
    if (!item) return { ok: false, notify: [], error: "Item not found" };
    const instance = this.store.getArrInstance(item.instanceId);
    try {
      await this.fs.rename(review.sidecarPath, review.sourcePath);
    } catch (err) {
      if (!isCrossDevice(err)) {
        return {
          ok: false,
          notify: [],
          error: err instanceof Error ? err.message : "Could not replace the library file",
        };
      }
      try {
        await this.transferFor(this.store.getSettings()).move(review.sidecarPath, review.sourcePath);
      } catch (moveErr) {
        return {
          ok: false,
          notify: [],
          error: moveErr instanceof Error ? moveErr.message : "Could not replace the library file",
        };
      }
    }
    try {
      // original was overwritten by rename when sidecar and source are different devices?
      // If rename across devices fails we already returned. When sidecar is on another path,
      // rename moves sidecar onto source path, replacing the original.
    } catch {
      /* ignore */
    }
    this.store.setReviewStatus(reviewId, "kept");
    this.store.addHistory(item.id, item.title, "kept");
    const notify = [];
    if (instance) notify.push(await notifyArrRename(this.fetchImpl, instance, item));
    for (const player of this.store.listPlayers().filter((p) => p.enabled)) {
      notify.push(await notifyPlayer(this.fetchImpl, player));
    }
    const failed = notify.filter((n) => !n.ok);
    return { ok: true, notify, error: failed.length ? failed.map((f) => `${f.target}: ${f.error}`).join("; ") : undefined };
  }

  async discard(reviewId: number): Promise<{ ok: boolean; error?: string }> {
    const review = this.store.getReview(reviewId);
    if (!review || review.status !== "pending") return { ok: false, error: "Review not found" };
    await this.fs.unlink(review.sidecarPath).catch(() => undefined);
    this.store.setReviewStatus(reviewId, "discarded");
    const item = this.store.getLibraryItem(review.itemId);
    this.store.addHistory(review.itemId, item?.title ?? "item", "discarded");
    return { ok: true };
  }
}

function isCrossDevice(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EXDEV");
}

export function inOffPeak(start: string, end: string, now: Date): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const s = toMins(start);
  const e = toMins(end);
  if (s <= e) return mins >= s && mins < e;
  return mins >= s || mins < e;
}
