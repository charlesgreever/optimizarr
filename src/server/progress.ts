export const JOB_PHASES = [
  "queued",
  "held",
  "copying",
  "remuxing",
  "transcoding",
  "finishing",
] as const;

export type JobPhase = (typeof JOB_PHASES)[number];

export type WorkPhase = Exclude<JobPhase, "queued" | "held">;

export type ProgressUpdate = {
  phase: WorkPhase;
  progress: number;
  copiedBytes?: number;
  totalBytes?: number;
  outTimeSec?: number;
  durationSec?: number;
  etaSec?: number | null;
};

export function isJobPhase(value: unknown): value is JobPhase {
  return typeof value === "string" && (JOB_PHASES as readonly string[]).includes(value);
}

export function clampProgress(value: number, opts?: { allowComplete?: boolean }): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const cap = opts?.allowComplete ? 1 : 0.99;
  return Math.min(value, cap);
}

export function ratioProgress(done: number, total: number, opts?: { allowComplete?: boolean }): number {
  if (total <= 0 || done <= 0) return 0;
  return clampProgress(done / total, opts);
}

export function jobPhaseLabel(
  phase: JobPhase,
  opts?: { targetCodec?: "hevc" | "av1"; copyMode?: "auto" | "ssh" | "mount" | "proxy" },
): string {
  switch (phase) {
    case "queued":
      return "Waiting in the queue";
    case "held":
      return "Waiting for the off-peak window";
    case "copying":
      return opts?.copyMode === "proxy" ? "Copying to the review path" : "Copying on the NAS";
    case "remuxing":
      return "Remuxing tracks";
    case "transcoding":
      return opts?.targetCodec === "av1" ? "Transcoding to AV1" : "Transcoding to HEVC";
    case "finishing":
      return "Checking the sidecar";
  }
}

export function phaseForPlan(actions: string[] | undefined): WorkPhase {
  if (actions?.includes("remux")) return "remuxing";
  if (actions?.includes("transcode")) return "transcoding";
  if (actions?.includes("add_stereo")) return "remuxing";
  return "copying";
}

export function parseFfmpegOutTime(text: string): number | null {
  const ms = /out_time_ms=(\d+)/.exec(text);
  if (ms) return Number(ms[1]) / 1000;
  const us = /out_time_us=(\d+)/.exec(text);
  if (us) return Number(us[1]) / 1_000_000;
  return null;
}

export function parseCopiedBytes(text: string): number | null {
  const match = /(\d+)\s+bytes/.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export const REVIEW_STATUSES = ["pending", "keeping", "kept", "discarded"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_PHASES = ["moving", "copying", "notifying"] as const;
export type ReviewPhase = (typeof REVIEW_PHASES)[number];

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && (REVIEW_STATUSES as readonly string[]).includes(value);
}

export function reviewPhaseLabel(status: ReviewStatus | string, phase: ReviewPhase | string | null): string | null {
  if (status !== "keeping") return null;
  if (phase === "notifying") return "Telling the library apps and players";
  if (phase === "copying") return "Copying sidecar into the library folder";
  return "Moving the sidecar onto the library file";
}

export function etaSec(done: number, total: number, elapsedSec: number): number | null {
  if (done <= 0 || total <= 0 || elapsedSec <= 0 || done >= total) return null;
  const rate = done / elapsedSec;
  if (rate <= 0) return null;
  return (total - done) / rate;
}
