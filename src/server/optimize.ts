import { execFile } from "node:child_process";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { isIsoPath } from "./inspect.ts";
import { parseFfprobe } from "./inspect.ts";
import type { ExecutablePlan, InspectionReport, Suggestion, WriteMode } from "./types.ts";
import { planHasVideoTranscode } from "./types.ts";

const execFileAsync = promisify(execFile);

export type OptimizeRequest = {
  sourcePath: string;
  reviewDir: string;
  suggestion?: Suggestion;
  plan?: ExecutablePlan;
  report: InspectionReport;
  target: "hevc" | "av1";
  backend: "cuda" | "vaapi" | "none";
  ffmpeg: string;
  ffprobe: string;
  mkvmerge: string;
  conservative: boolean;
  onPhase?: (phase: "muxing" | "creating_stereo" | "transcoding" | "finishing", progress: number) => void;
  isCancelled?: () => boolean;
};

export type OptimizeResult = {
  sidecarPath: string;
  output: InspectionReport;
};

export type Optimizer = (req: OptimizeRequest) => Promise<OptimizeResult>;

export function isExecutablePlan(value: unknown): value is ExecutablePlan {
  return Boolean(value && typeof value === "object" && value !== null && "origin" in value && "video" in value);
}

export function planFromSuggestion(suggestion: Suggestion, writeMode: WriteMode = "sidecar"): ExecutablePlan {
  const transcode = suggestion.actions.includes("transcode");
  const hours = Math.max(suggestion.now.sizePerHourGb && suggestion.now.sizeBytes
    ? suggestion.now.sizeBytes / (suggestion.now.sizePerHourGb * 1024 ** 3)
    : 1, 0.1);
  const targetBytes = Math.round((suggestion.after.sizePerHourGb ?? 2.5) * hours * 1024 ** 3);
  const codec = suggestion.after.codec?.toLowerCase() === "av1" ? "av1" : "hevc";
  const stereoSource = suggestion.keepAudio[0] ?? 0;
  return {
    origin: "bulk",
    video: transcode
      ? { kind: "size", codec, targetBytes, downscale1080p: false, bitDepth: 8 }
      : { kind: "copy" },
    audio: [
      ...suggestion.keepAudio.map((index) => ({ op: "keep" as const, index })),
      ...suggestion.stripAudio.map((index) => ({ op: "remove" as const, index })),
      ...(suggestion.actions.includes("add_stereo")
        ? [{ op: "add_downmix" as const, index: stereoSource, channels: 2 }]
        : []),
    ],
    subtitles: [
      ...suggestion.keepSubs.map((index) => ({ op: "keep" as const, index })),
      ...suggestion.stripSubs.map((index) => ({ op: "remove" as const, index })),
    ],
    container: "mkv",
    writeMode,
    warning: suggestion.warning,
    reasons: [...suggestion.reasons],
    estimatedOutputBytes: suggestion.after.sizeBytes,
    category: suggestion.category,
  };
}

export function resolvePlan(value: Suggestion | ExecutablePlan | undefined, writeMode: WriteMode = "sidecar"): ExecutablePlan {
  if (isExecutablePlan(value)) return value;
  if (!value) throw new Error("The job has no executable plan.");
  return planFromSuggestion(value, writeMode);
}

export function ffmpegOptimizer(): Optimizer {
  return async (req) => {
    const plan = resolvePlan(req.plan ?? req.suggestion);
    if (req.backend === "none" && planHasVideoTranscode(plan)) {
      throw new Error("Hardware encode is unavailable. Optimizarr will not fall back to a software encode.");
    }
    await mkdir(req.reviewDir, { recursive: true });
    const workDir = join(req.reviewDir, ".work");
    await mkdir(workDir, { recursive: true });
    const sidecarPath = join(req.reviewDir, `${basename(req.sourcePath).replace(/\.[^.]+$/, "")}.mkv`);
    const temps: string[] = [];
    try {
      let current = req.sourcePath;
      if (isIsoPath(req.sourcePath) && plan.video.kind === "copy") {
        req.onPhase?.("muxing", 0.2);
        const remuxed = join(workDir, `${Date.now()}-iso.mkv`);
        temps.push(remuxed);
        await run(req.ffmpeg, isoRemuxArgs(current, remuxed, plan));
        current = remuxed;
      } else {
        const extras = await createAudioExtras(req, plan, workDir, current, temps);
        if (needsMux(plan) || extras.length) {
          req.onPhase?.("muxing", 0.35);
          const muxed = join(workDir, `${Date.now()}-mux.mkv`);
          temps.push(muxed);
          await run(req.mkvmerge, muxPlanArgs(current, muxed, plan, extras));
          current = muxed;
        }
      }
      if (planHasVideoTranscode(plan)) {
        if (req.isCancelled?.()) throw new CancelledError();
        req.onPhase?.("transcoding", 0.5);
        const encoded = join(workDir, `${Date.now()}-enc.mkv`);
        temps.push(encoded);
        await run(req.ffmpeg, encodeArgs(current, encoded, { ...req, plan }));
        current = encoded;
      }
      req.onPhase?.("finishing", 0.9);
      if (current !== sidecarPath) await copyFile(current, sidecarPath);
      const output = await probeOutput(req.ffprobe, sidecarPath);
      if (output.durationSec <= 0 || (req.report.durationSec > 0 && output.durationSec < req.report.durationSec * 0.9)) {
        throw new Error("The finished file is missing duration or is shorter than the original.");
      }
      return { sidecarPath, output };
    } catch (error) {
      await safeUnlink(sidecarPath);
      throw error;
    } finally {
      await Promise.all(temps.map(safeUnlink));
    }
  };
}

async function createAudioExtras(
  req: OptimizeRequest,
  plan: ExecutablePlan,
  workDir: string,
  source: string,
  temps: string[],
): Promise<string[]> {
  const extras: string[] = [];
  for (const op of plan.audio) {
    if (op.op !== "replace_aac" && op.op !== "replace_downmix" && op.op !== "add_downmix") continue;
    req.onPhase?.("creating_stereo", 0.15);
    const dest = join(workDir, `${Date.now()}-${op.op}-${op.index}.aac`);
    temps.push(dest);
    const channels = op.op === "replace_aac"
      ? req.report.audio.find((t) => t.index === op.index)?.channels ?? 2
      : op.channels;
    await run(req.ffmpeg, audioAacArgs(source, dest, op.index, channels, req.conservative ? "128k" : "160k"));
    extras.push(dest);
  }
  return extras;
}

function needsMux(plan: ExecutablePlan): boolean {
  return plan.audio.some((op) => op.op !== "keep") || plan.subtitles.some((op) => op.op !== "keep");
}

export class CancelledError extends Error {
  constructor() {
    super("The job was cancelled.");
    this.name = "CancelledError";
  }
}

export function muxArgs(source: string, dest: string, suggestion: Suggestion, stereo?: string): string[] {
  return muxPlanArgs(source, dest, planFromSuggestion(suggestion), stereo ? [stereo] : []);
}

export function muxPlanArgs(source: string, dest: string, plan: ExecutablePlan, extras: string[] = []): string[] {
  const keepAudio = plan.audio.filter((op) => op.op === "keep" || op.op === "add_downmix").map((op) => op.index);
  const replaced = new Set(plan.audio.filter((op) => op.op === "replace_aac" || op.op === "replace_downmix").map((op) => op.index));
  const audio = keepAudio.filter((index) => !replaced.has(index));
  const keepSubs = plan.subtitles.filter((op) => op.op === "keep").map((op) => op.index);
  const args = ["-o", dest];
  if (audio.length) args.push("--audio-tracks", [...new Set(audio)].join(","));
  if (keepSubs.length) args.push("--subtitle-tracks", keepSubs.join(","));
  args.push(source);
  args.push(...extras);
  return args;
}

export function isoRemuxArgs(source: string, dest: string, plan: ExecutablePlan): string[] {
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", source, "-map", "0:v:0"];
  for (const op of plan.audio) {
    if (op.op === "remove") continue;
    args.push("-map", `0:${op.index}`);
  }
  for (const op of plan.subtitles) {
    if (op.op === "remove") continue;
    args.push("-map", `0:${op.index}`);
  }
  args.push("-c", "copy", dest);
  return args;
}

export function audioAacArgs(source: string, dest: string, index: number, channels: number, bitrate: string): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-map",
    `0:${index}`,
    "-ac",
    String(channels),
    "-c:a",
    "aac",
    "-b:a",
    bitrate,
    dest,
  ];
}

const BANNER = /^(ffmpeg version|copyright|built with|configuration:|libav)/i;

export function formatToolError(bin: string, error: { message?: string; stderr?: string | Buffer }): string {
  const stderr = String(error.stderr ?? "").trim();
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !BANNER.test(line));
  const useful =
    lines.find((line) => /error|cannot|failed|invalid|not found|no nvenc|unknown encoder/i.test(line)) ??
    lines.at(-1) ??
    "The tool exited without a useful message.";
  return `${bin} failed. ${useful}`;
}

export function encodeArgs(source: string, dest: string, req: OptimizeRequest): string[] {
  const plan = req.plan ?? (req.suggestion ? planFromSuggestion(req.suggestion) : undefined);
  const video = plan?.video;
  const codec = video && video.kind !== "copy" ? video.codec : req.target;
  const encoder = codec === "av1"
    ? req.backend === "vaapi" ? "av1_vaapi" : "av1_nvenc"
    : req.backend === "vaapi" ? "hevc_vaapi" : "hevc_nvenc";
  const tenBit = (video && video.kind !== "copy" ? video.bitDepth : req.report.bitDepth) >= 10;
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", source];
  if (req.backend === "vaapi") args.push("-vaapi_device", "/dev/dri/renderD128");
  if (video?.kind !== "copy" && video?.downscale1080p) args.push("-vf", "scale=1920:1080");
  args.push("-c:v", encoder);
  if (tenBit && encoder.includes("nvenc")) args.push("-profile:v", "main10");
  if (video?.kind === "quality") {
    if (req.backend === "vaapi") args.push("-qp", String(video.quality));
    else args.push("-cq", String(video.quality));
  } else {
    const hours = req.report.durationSec / 3600 || 1;
    const targetBytes = video?.kind === "size"
      ? Math.max(1_000_000, video.targetBytes - 80_000_000)
      : (req.suggestion?.after.sizePerHourGb ?? 2.5) * hours * 1024 ** 3;
    const bitrate = Math.max(800_000, Math.round((targetBytes * 8) / Math.max(req.report.durationSec, 1)));
    args.push("-b:v", String(bitrate));
  }
  args.push("-pix_fmt", tenBit ? "p010le" : "yuv420p", "-c:a", "copy", "-c:s", "copy", dest);
  return args;
}

async function run(bin: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(bin, args, { timeout: 0, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    const err = error as { message?: string; stderr?: string };
    throw new Error(formatToolError(bin, { message: err.message, stderr: err.stderr }));
  }
}

async function probeOutput(ffprobe: string, path: string): Promise<InspectionReport> {
  const { stdout } = await execFileAsync(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path], {
    maxBuffer: 1024 * 512,
  });
  const size = (await stat(path)).size;
  return parseFfprobe(path, size, JSON.parse(stdout) as Record<string, unknown>);
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // The temp file may never have been created.
  }
}
