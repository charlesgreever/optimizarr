import { createHash, timingSafeEqual } from "node:crypto";
import { verifyPassword } from "./passwords.ts";
import { isJobPhase, jobPhaseLabel, type JobPhase } from "./progress.ts";
import type { Store } from "./store.ts";

export type WidgetRunning = {
  title: string;
  phase: JobPhase;
  progress: number;
  phaseLabel: string;
};

export type WidgetPayload = {
  ok: true;
  service: "optimizarr";
  status: string;
  running: WidgetRunning | null;
  runningTitle: string | null;
  runningPhase: JobPhase | null;
  runningProgress: number | null;
  queued: number;
  review: number;
  suggestions: number;
  failed: number;
  lastError: string | null;
  movies: number;
  episodes: number;
  library: { movies: number; episodes: number };
};

export function hashWidgetToken(token: string): string {
  return `sha256$${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

export function verifyWidgetToken(token: string, stored: string): boolean {
  if (stored.startsWith("sha256$")) {
    return timingSafeEqualString(hashWidgetToken(token), stored);
  }
  return verifyPassword(token, stored);
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function widgetKeyFromHeaders(headers: Headers): string | null {
  const apiKey = headers.get("x-api-key")?.trim();
  if (apiKey) return apiKey;
  const auth = headers.get("authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim() || null;
}

export function authorizeWidget(opts: {
  hasSession: boolean;
  presentedKey: string | null;
  storedHash: string | null;
  envKey?: string;
}): boolean {
  if (opts.hasSession) return true;
  if (!opts.presentedKey) return false;
  if (opts.envKey && timingSafeEqualString(opts.presentedKey, opts.envKey)) return true;
  if (opts.storedHash && verifyWidgetToken(opts.presentedKey, opts.storedHash)) return true;
  return false;
}

export function widgetPayload(store: Store): WidgetPayload {
  const runningRow = store.getRunningJob();
  const settings = store.getSettings();
  const running = runningRow
    ? {
        title: runningRow.displayTitle,
        phase: isJobPhase(runningRow.phase) ? runningRow.phase : "finishing",
        progress: runningRow.progress,
        phaseLabel: jobPhaseLabel(isJobPhase(runningRow.phase) ? runningRow.phase : "finishing", {
          targetCodec: settings.targetCodec,
          copyMode: settings.copyMode,
        }),
      }
    : null;
  const queued = store.countJobs(["queued", "held"]);
  const review = store.countReviews("pending");
  const suggestions = store.countOpenSuggestions();
  const failed = store.countJobs(["failed"]);
  const movies = store.countLibraryByType("movie");
  const episodes = store.countLibraryByType("episode");
  return {
    ok: true,
    service: "optimizarr",
    status: widgetStatus(running, queued, review),
    running,
    runningTitle: running?.title ?? null,
    runningPhase: running?.phase ?? null,
    runningProgress: running?.progress ?? null,
    queued,
    review,
    suggestions,
    failed,
    lastError: store.lastJobError(),
    movies,
    episodes,
    library: { movies, episodes },
  };
}

export function widgetStatus(running: WidgetRunning | null, queued: number, review: number): string {
  if (running) return `${running.phaseLabel} · ${running.title}`;
  if (queued > 0) return `${queued} waiting`;
  if (review > 0) return `${review} ready to review`;
  return "Idle";
}
