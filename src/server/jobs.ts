import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { InspectionReport } from "./inspect.ts";
import { notifyArrRename, notifyPlayer } from "./notify.ts";
import { assertHardware, detectBackends, type EncodeBackends } from "./hardware.ts";
import { IntegrityError, remuxSidecarPath, reviewPathFor, tempSidecarPath, type Optimizer } from "./optimize.ts";
import { etaSec, phaseForPlan, type JobPhase, type ProgressUpdate } from "./progress.ts";
import { reviewPathInsideLibrary } from "./paths.ts";
import { createStorage, storageConfigFromSettings, type Transfer } from "./storage.ts";
import type { SuggestionPlan } from "./suggest.ts";
import type { Store } from "./store.ts";
import type { FetchLike } from "./arr.ts";
import { sizePerHourGb } from "./inspect.ts";
import { displayTitle } from "./titles.ts";
import type { Settings } from "./types.ts";

export class JobService {
  private aborts = new Map<number, AbortController>();
  private starting = false;

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
    const libraries = this.store.listLibraryItems().flatMap((row) => [row.path, row.folderPath ?? ""]);
    if (reviewPathInsideLibrary(settings.reviewPath, libraries)) {
      return { error: "Review path must sit outside Arr library folders", status: 400 };
    }
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
      const message = err instanceof Error ? err.message : "Could not write to the review path";
      return { error: message, status: 400 };
    }
    const jobId = this.store.createJob(item.id, suggestion.id, suggestion.plan, this.now().toISOString());
    void this.processQueue().catch(() => undefined);
    return { jobId };
  }

  async processQueue(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    let started: Array<Promise<void>> = [];
    try {
      started = this.startReadyJobs();
    } finally {
      this.starting = false;
    }
    for (const run of started) {
      void run.finally(() => {
        void this.processQueue().catch(() => undefined);
      });
    }
    if (started.length) await Promise.all(started);
  }

  private startReadyJobs(): Array<Promise<void>> {
    try {
      return this.collectReadyJobs();
    } catch (err) {
      if (isClosedStore(err)) return [];
      throw err;
    }
  }

  private collectReadyJobs(): Array<Promise<void>> {
    const settings = this.store.getSettings();
    const jobs = this.store.listJobs();
    const running = jobs.filter((j) => j.status === "running").length;
    let slots = Math.max(0, settings.concurrency - running);
    const inWindow = !settings.offPeakEnabled || inOffPeak(settings.offPeakStart, settings.offPeakEnd, this.now());
    const runningJobs: Promise<void>[] = [];
    for (const job of [...jobs].reverse()) {
      if (slots <= 0) break;
      if (job.status !== "queued" && job.status !== "held") continue;
      const runNow = Boolean((this.store.getJob(job.id as number) as { runNow?: boolean } | undefined)?.runNow);
      if (!inWindow && !runNow) {
        this.store.updateJob(job.id as number, { status: "held", phase: "held", progress: 0, etaSec: null });
        continue;
      }
      slots -= 1;
      runningJobs.push(this.runJob(job.id as number));
    }
    return runningJobs;
  }

  recoverInterruptedJobs(): void {
    for (const job of this.store.listJobs()) {
      if (job.status === "running") {
        this.store.updateJob(job.id as number, {
          status: "queued",
          phase: "queued",
          progress: 0,
          etaSec: null,
          error: "Requeued after restart",
        });
      }
    }
    for (const review of this.store.listReviews(["keeping"])) {
      this.store.updateReview(review.id as number, {
        status: "pending",
        phase: null,
        progress: 0,
        error: "Keep was interrupted. The original and sidecar are still on disk.",
      });
    }
  }

  async cancel(jobId: number): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
    const job = this.store.getJob(jobId);
    if (!job) return { ok: false, error: "Job not found", status: 404 };
    const status = String(job.status);
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      return { ok: false, error: "Only queued, held, or running jobs can be cancelled", status: 409 };
    }
    this.aborts.get(jobId)?.abort();
    this.store.updateJob(jobId, { status: "cancelled", etaSec: null, finishedAt: this.now().toISOString() });
    const item = this.store.getLibraryItem(job.itemId as number);
    if (item) {
      this.store.addHistory(item.id, displayTitle(item), "cancelled");
      const sidecarPath = reviewPathFor(this.store.getSettings().reviewPath, item.title, item.id);
      await this.fs.unlink(tempSidecarPath(sidecarPath)).catch(() => undefined);
      await this.fs.unlink(remuxSidecarPath(sidecarPath)).catch(() => undefined);
      if (!this.store.pendingReviewForItem(item.id)) {
        await this.fs.unlink(sidecarPath).catch(() => undefined);
      }
    }
    return { ok: true };
  }

  async runJob(jobId: number): Promise<void> {
    const job = this.store.getJob(jobId);
    if (!job || job.status === "cancelled") return;
    const item = this.store.getLibraryItem(job.itemId as number);
    if (!item) return;
    const settings = this.store.getSettings();
    const report = this.store.getInspection(item.id) as InspectionReport | undefined;
    const livePlan = JSON.parse(String(job.planJson ?? "{}")) as SuggestionPlan;
    const sidecarPath = reviewPathFor(settings.reviewPath, item.title, item.id);
    const abort = new AbortController();
    this.aborts.set(jobId, abort);
    const startPhase = phaseForPlan(livePlan.actions);
    this.store.updateJob(jobId, {
      status: "running",
      phase: startPhase,
      progress: 0,
      etaSec: null,
      startedAt: this.now().toISOString(),
    });
    const clocks = new Map<JobPhase, { started: number; lastDone: number }>();
    try {
      if (this.isCancelled(jobId)) return;
      if (!report) throw new Error("No inspection report");
      const codec = settings.targetCodec === "av1" && this.backends.av1 ? "av1" : "hevc";
      if (livePlan.actions?.includes("transcode")) {
        assertHardware(this.backends, codec);
      }
      const result = await this.optimize({
        sourcePath: item.path,
        sidecarPath,
        plan: livePlan,
        report,
        transfer: this.transferFor(settings),
        signal: abort.signal,
        backends: this.backends,
        sizeCaps: settings.sizeCapsGbPerHour,
        targetCodec: codec,
        onProgress: (update) => this.recordProgress(jobId, update, clocks),
      });
      if (this.isCancelled(jobId)) {
        await this.fs.unlink(result.sidecarPath).catch(() => undefined);
        await this.fs.unlink(tempSidecarPath(sidecarPath)).catch(() => undefined);
        await this.fs.unlink(remuxSidecarPath(sidecarPath)).catch(() => undefined);
        return;
      }
      const outHour = sizePerHourGb({ sizeBytes: result.sizeBytes, durationSec: result.durationSec });
      const cap = settings.sizeCapsGbPerHour[livePlan.category] ?? settings.sizeCapsGbPerHour.movie1080p;
      const flagged =
        result.sizeBytes > report.sizeBytes || (outHour !== null && livePlan.category && outHour > cap);
      this.store.updateJob(jobId, { phase: "finishing", progress: 0, etaSec: null });
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
      this.store.updateJob(jobId, {
        status: "succeeded",
        phase: "finishing",
        progress: 1,
        etaSec: null,
        finishedAt: this.now().toISOString(),
      });
      this.store.addHistory(item.id, displayTitle(item), flagged ? "flagged" : "finished");
    } catch (err) {
      await this.fs.unlink(tempSidecarPath(sidecarPath)).catch(() => undefined);
      await this.fs.unlink(remuxSidecarPath(sidecarPath)).catch(() => undefined);
      await this.fs.unlink(sidecarPath).catch(() => undefined);
      if (this.isCancelled(jobId) || isAbortError(err)) {
        this.store.updateJob(jobId, { status: "cancelled", etaSec: null, finishedAt: this.now().toISOString() });
        return;
      }
      const message = err instanceof IntegrityError || err instanceof Error ? err.message : "Job failed";
      this.store.updateJob(jobId, {
        status: "failed",
        error: message,
        etaSec: null,
        finishedAt: this.now().toISOString(),
      });
      this.store.addHistory(item.id, displayTitle(item), "failed", message);
    } finally {
      this.aborts.delete(jobId);
    }
  }

  private isCancelled(jobId: number): boolean {
    try {
      return this.store.getJob(jobId)?.status === "cancelled";
    } catch (err) {
      if (isClosedStore(err)) return true;
      throw err;
    }
  }

  private recordProgress(
    jobId: number,
    update: ProgressUpdate,
    clocks: Map<JobPhase, { started: number; lastDone: number }>,
  ): void {
    if (this.isCancelled(jobId)) return;
    let clock = clocks.get(update.phase);
    if (!clock) {
      clock = { started: Date.now(), lastDone: 0 };
      clocks.set(update.phase, clock);
    }
    const done =
      update.copiedBytes ??
      update.outTimeSec ??
      (update.progress > 0 ? update.progress : 0);
    const total =
      update.totalBytes ??
      update.durationSec ??
      (update.progress > 0 ? 1 : 0);
    clock.lastDone = done;
    const elapsed = (Date.now() - clock.started) / 1000;
    this.store.updateJob(jobId, {
      phase: update.phase,
      progress: update.progress,
      etaSec: update.etaSec ?? etaSec(done, total, elapsed),
    });
  }

  startKeep(reviewId: number): { ok: boolean; accepted?: boolean; error?: string; status?: number } {
    const review = this.store.getReview(reviewId);
    if (!review) return { ok: false, error: "Review not found", status: 404 };
    if (review.status === "keeping") {
      return { ok: false, error: "This title is already being kept", status: 409 };
    }
    if (review.status !== "pending") return { ok: false, error: "Review not found", status: 400 };
    this.store.updateReview(reviewId, { status: "keeping", phase: "moving", progress: 0, error: null });
    void this.applyKeep(reviewId).catch((err) => {
      // Shutdown after the process closed SQLite: nothing left to record.
      if (isClosedStore(err)) return;
      const message = err instanceof Error ? err.message : "Could not replace the library file";
      try {
        if (this.store.getReview(reviewId)?.status === "keeping") this.failKeep(reviewId, message);
      } catch (storeErr) {
        if (!isClosedStore(storeErr)) throw storeErr;
      }
    });
    return { ok: true, accepted: true };
  }

  async keep(
    reviewId: number,
  ): Promise<{ ok: boolean; notify: { target: string; ok: boolean; error?: string }[]; error?: string }> {
    const review = this.store.getReview(reviewId);
    if (!review || (review.status !== "pending" && review.status !== "keeping")) {
      return { ok: false, notify: [], error: "Review not found" };
    }
    if (review.status === "pending") {
      this.store.updateReview(reviewId, { status: "keeping", phase: "moving", progress: 0, error: null });
    }
    return this.applyKeep(reviewId);
  }

  private async applyKeep(
    reviewId: number,
  ): Promise<{ ok: boolean; notify: { target: string; ok: boolean; error?: string }[]; error?: string }> {
    try {
      return await this.runKeep(reviewId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not replace the library file";
      if (this.store.getReview(reviewId)?.status === "keeping") this.failKeep(reviewId, message);
      return { ok: false, notify: [], error: message };
    }
  }

  private async runKeep(
    reviewId: number,
  ): Promise<{ ok: boolean; notify: { target: string; ok: boolean; error?: string }[]; error?: string }> {
    const review = this.store.getReview(reviewId);
    if (!review) return { ok: false, notify: [], error: "Review not found" };
    const item = this.store.getLibraryItem(review.itemId);
    if (!item) {
      this.store.updateReview(reviewId, { status: "pending", phase: null, error: "Item not found" });
      return { ok: false, notify: [], error: "Item not found" };
    }
    const instance = this.store.getArrInstance(item.instanceId);
    try {
      await this.fs.rename(review.sidecarPath, review.sourcePath);
    } catch (err) {
      if (!isCrossDevice(err)) {
        const message = err instanceof Error ? err.message : "Could not replace the library file";
        this.failKeep(reviewId, message);
        return { ok: false, notify: [], error: message };
      }
      const replacementPath = `${review.sourcePath}.optimizarr-replacement-${reviewId}`;
      try {
        this.store.updateReview(reviewId, { phase: "copying", progress: 0, error: null });
        const transfer = this.transferFor(this.store.getSettings());
        await transfer.copy(review.sidecarPath, replacementPath, (copied, total) => {
          this.store.updateReview(reviewId, {
            phase: "copying",
            progress: total > 0 ? Math.min(copied / total, 0.99) : 0,
          });
        });
        try {
          await this.fs.rename(replacementPath, review.sourcePath);
        } catch (replaceErr) {
          await this.fs.unlink(replacementPath).catch(() => undefined);
          throw replaceErr;
        }
        await this.fs.unlink(review.sidecarPath).catch(() => undefined);
      } catch (moveErr) {
        await this.fs.unlink(replacementPath).catch(() => undefined);
        const message = moveErr instanceof Error ? moveErr.message : "Could not replace the library file";
        this.failKeep(reviewId, message);
        return { ok: false, notify: [], error: message };
      }
    }
    this.store.updateReview(reviewId, { phase: "notifying", progress: 1, error: null });
    let notify: { target: string; ok: boolean; error?: string }[] = [];
    let notifyError: string | undefined;
    try {
      if (instance) notify.push(await notifyArrRename(this.fetchImpl, instance, item));
      for (const player of this.store.listPlayers().filter((p) => p.enabled)) {
        notify.push(await notifyPlayer(this.fetchImpl, player));
      }
      const failed = notify.filter((n) => !n.ok);
      notifyError = failed.length ? failed.map((f) => `${f.target}: ${f.error}`).join("; ") : undefined;
    } catch (err) {
      notifyError = err instanceof Error ? err.message : "Could not notify players";
    }
    this.store.updateReview(reviewId, { status: "kept", phase: "notifying", progress: 1, error: notifyError ?? null });
    this.store.addHistory(item.id, displayTitle(item), "kept", notifyError);
    return { ok: true, notify, error: notifyError };
  }

  private failKeep(reviewId: number, message: string): void {
    this.store.updateReview(reviewId, { status: "pending", phase: null, progress: 0, error: message });
  }

  async discard(reviewId: number): Promise<{ ok: boolean; error?: string }> {
    const review = this.store.getReview(reviewId);
    if (!review || review.status !== "pending") return { ok: false, error: "Review not found" };
    try {
      await this.fs.unlink(review.sidecarPath);
    } catch (err) {
      if (!isMissingFile(err)) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not delete the sidecar" };
      }
    }
    this.store.setReviewStatus(reviewId, "discarded");
    const item = this.store.getLibraryItem(review.itemId);
    this.store.addHistory(review.itemId, item ? displayTitle(item) : "item", "discarded");
    return { ok: true };
  }
}

function isMissingFile(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT");
}

function isClosedStore(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { code?: string; message?: string };
  return rec.code === "ERR_INVALID_STATE" || Boolean(rec.message?.includes("not open"));
}

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError");
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
