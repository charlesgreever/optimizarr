import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { isIsoPath, parseFfprobe } from "./inspect.ts";
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
      const emit = progressEmitter(req.onPhase);
      if (isIsoPath(req.sourcePath)) {
        emit("muxing", 0.02);
        const remuxed = join(workDir, `${Date.now()}-iso.mkv`);
        temps.push(remuxed);
        await remuxIso(req.ffmpeg, req.ffprobe, current, remuxed, req.report, {
          onTime: (sec) => emit("muxing", scaleProgress(0.02, 0.28, sec / Math.max(req.report.durationSec, 1))),
          isCancelled: req.isCancelled,
        });
        current = remuxed;
      }
      const extras = await createAudioExtras(req, plan, workDir, current, temps);
      if (needsMux(plan) || extras.length) {
        emit("muxing", 0.3);
        const muxed = join(workDir, `${Date.now()}-mux.mkv`);
        temps.push(muxed);
        await run(req.mkvmerge, muxPlanArgs(current, muxed, plan, extras), {
          onChunk: (text) => {
            const ratio = parseMkvmergeProgress(text);
            if (ratio != null) emit("muxing", scaleProgress(0.3, 0.42, ratio));
          },
          isCancelled: req.isCancelled,
        });
        current = muxed;
      }
      if (planHasVideoTranscode(plan)) {
        if (req.isCancelled?.()) throw new CancelledError();
        emit("transcoding", 0.45);
        const encodeReport = await probeOutput(req.ffprobe, current).catch(() => req.report);
        const encoded = join(workDir, `${Date.now()}-enc.mkv`);
        temps.push(encoded);
        const encodePlan = plan.video.kind === "copy"
          ? plan
          : { ...plan, video: { ...plan.video, bitDepth: encodeReport.bitDepth || plan.video.bitDepth } };
        const durationReport = isoRemuxIsShort(req.report.durationSec, encodeReport.durationSec)
          ? req.report
          : encodeReport.durationSec > 1
            ? encodeReport
            : req.report;
        const durationSec = Math.max(durationReport.durationSec, 1);
        await run(req.ffmpeg, encodeArgs(current, encoded, { ...req, plan: encodePlan, report: durationReport }), {
          onChunk: (text) => {
            const sec = parseFfmpegProgress(text);
            if (sec != null) emit("transcoding", scaleProgress(0.45, 0.92, sec / durationSec));
          },
          isCancelled: req.isCancelled,
        });
        current = encoded;
      }
      emit("finishing", 0.95);
      if (current !== sidecarPath) await copyFile(current, sidecarPath);
      const output = await probeOutput(req.ffprobe, sidecarPath);
      if (output.durationSec <= 0 || (req.report.durationSec > 0 && output.durationSec < req.report.durationSec * 0.9)) {
        const srcMin = Math.round(req.report.durationSec / 60);
        const outMin = Math.round(output.durationSec / 60);
        throw new Error(
          isIsoPath(req.sourcePath)
            ? `The remuxed file is ${outMin} minutes; the disc listing was ${srcMin} minutes. ffmpeg likely copied a short title instead of the feature.`
            : "The finished file is missing duration or is shorter than the original.",
        );
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

export function optimizeSteps(sourcePath: string, plan: ExecutablePlan): Array<"iso_remux" | "mux" | "encode"> {
  const steps: Array<"iso_remux" | "mux" | "encode"> = [];
  if (isIsoPath(sourcePath)) steps.push("iso_remux");
  if (needsMux(plan) || plan.audio.some((op) => op.op === "add_downmix" || op.op === "replace_aac" || op.op === "replace_downmix")) {
    steps.push("mux");
  }
  if (planHasVideoTranscode(plan)) steps.push("encode");
  return steps;
}

export function isBlurayIso(path: string): boolean {
  return /bdmv|br-disk|bd-disk|bluray|blu-ray/i.test(path);
}

export function isoDemuxArgs(source: string, force?: "bluray" | "plain"): string[] {
  if (force === "plain") return ["-i", source];
  if (force === "bluray" || isBlurayIso(source)) return ["-i", `bluray:${source}`];
  return ["-i", source];
}

export function isoInputAttempts(source: string): string[][] {
  const bluray = ["-i", `bluray:${source}`];
  const blurayFmt = ["-f", "bluray", "-i", source];
  const plain = ["-i", source];
  const playlists = [0, 1].map((n) => ["-playlist", String(n), "-i", `bluray:${source}`]);
  if (isBlurayIso(source)) return [bluray, ...playlists, blurayFmt, plain];
  return [plain, bluray, ...playlists];
}

export function isoRemuxIsShort(expectedSec: number, actualSec: number): boolean {
  if (!(actualSec > 1)) return true;
  if (actualSec < 60) return true;
  return expectedSec > 120 && actualSec < expectedSec * 0.5;
}

export function isoCopyMaps(report?: InspectionReport): string[] {
  const maps = ["-map", "0"];
  // Dummy 0-channel AC3 on some Blu-rays makes Matroska reject the header ("sample rate not set").
  for (const track of report?.audio ?? []) {
    if (track.channels <= 0) maps.push("-map", `-0:${track.index}`);
  }
  return maps;
}

export function isoRemuxArgs(source: string, dest: string, _plan?: ExecutablePlan, report?: InspectionReport): string[] {
  return isoRemuxArgSets(source, dest, report)[0] ?? [];
}

export function isoRemuxInputs(source: string, report?: InspectionReport): string[][] {
  const preferred = report?.isoPlaylist != null
    ? [["-playlist", String(report.isoPlaylist), "-i", `bluray:${source}`]]
    : [];
  const rest = isoInputAttempts(source).filter((args) => JSON.stringify(args) !== JSON.stringify(preferred[0]));
  return [...preferred, ...rest];
}

export function isoMapVariants(report?: InspectionReport): string[][] {
  return [
    isoCopyMaps(report),
    ["-map", "0:v:0", "-map", "0:a:0", "-map", "0:a:1", "-map", "0:a:2", "-map", "0:a:3", "-map", "0:a:4"],
    ["-map", "0:v:0", "-map", "0:a:0"],
  ];
}

export function isoRemuxArgSets(source: string, dest: string, report?: InspectionReport): string[][] {
  const head = [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-nostats",
    "-progress",
    "pipe:1",
    "-y",
    "-analyzeduration",
    "100M",
    "-probesize",
    "100M",
  ];
  const sets: string[][] = [];
  for (const input of isoRemuxInputs(source, report)) {
    for (const maps of isoMapVariants(report)) {
      sets.push([...head, ...input, ...maps, "-c", "copy", dest]);
    }
  }
  return sets;
}

async function remuxIso(
  ffmpeg: string,
  ffprobe: string,
  source: string,
  dest: string,
  report: InspectionReport,
  progress?: { onTime?: (sec: number) => void; isCancelled?: () => boolean },
): Promise<void> {
  let lastError: unknown;
  for (const args of isoRemuxArgSets(source, dest, report)) {
    try {
      await run(ffmpeg, args, {
        onChunk: (text) => {
          const sec = parseFfmpegProgress(text);
          if (sec != null) progress?.onTime?.(sec);
        },
        isCancelled: progress?.isCancelled,
      });
      const remuxed = await probeOutput(ffprobe, dest).catch(() => null);
      if (!remuxed || isoRemuxIsShort(report.durationSec, remuxed.durationSec)) {
        await safeUnlink(dest);
        const minutes = Math.max(1, Math.round((remuxed?.durationSec ?? 0) / 60));
        const listed = Math.max(1, Math.round(report.durationSec / 60));
        lastError = new Error(
          `The remuxed file is ${minutes} minutes; the disc listing was ${listed} minutes. ffmpeg likely copied a short title instead of the feature.`,
        );
        continue;
      }
      return;
    } catch (error) {
      lastError = error;
      await safeUnlink(dest);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("ffmpeg could not remux this disc image into a Matroska file.");
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
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", source];
  if (req.backend === "vaapi") args.push("-vaapi_device", "/dev/dri/renderD128");
  args.push("-map", "0:v:0", "-map", "0:a?", "-map", "0:s?");
  if (video?.kind !== "copy" && video?.downscale1080p) args.push("-vf", "scale=1920:1080");
  args.push("-c:v", encoder);
  if (tenBit && encoder.includes("nvenc")) args.push("-profile:v", "main10");
  if (video?.kind === "quality") {
    if (req.backend === "vaapi") args.push("-qp", String(video.quality));
    else args.push("-cq", String(video.quality), "-rc", "vbr");
  } else {
    args.push("-b:v", String(nvencBitrate(req, video)));
  }
  args.push("-pix_fmt", tenBit ? "p010le" : "yuv420p", "-c:a", "copy", "-c:s", "copy", dest);
  return args;
}

export function nvencBitrate(req: OptimizeRequest, video: ExecutablePlan["video"] | undefined): number {
  const durationSec = req.report.durationSec;
  if (!(durationSec > 1)) {
    throw new Error("Cannot pick a bitrate from the target file size because the file has no duration.");
  }
  const hours = durationSec / 3600;
  const targetBytes = video?.kind === "size"
    ? Math.max(1_000_000, video.targetBytes - 80_000_000)
    : (req.suggestion?.after.sizePerHourGb ?? 2.5) * hours * 1024 ** 3;
  const bitrate = Math.max(800_000, Math.round((targetBytes * 8) / durationSec));
  if (bitrate > 300_000_000) {
    const gb = (targetBytes / 1024 ** 3).toFixed(1);
    const minutes = Math.max(1, Math.round(durationSec / 60));
    throw new Error(
      `A ${gb} GB target over ${minutes} minutes needs ${(bitrate / 1_000_000).toFixed(0)} Mbps, which the hardware encoder will reject. The remux is probably a short title, not the feature.`,
    );
  }
  return bitrate;
}

export function parseFfmpegProgress(text: string): number | null {
  const us = [...text.matchAll(/out_time_us=(\d+)/g)].pop();
  if (us) return Number(us[1]) / 1_000_000;
  // ffmpeg's out_time_ms is microseconds despite the name.
  const ms = [...text.matchAll(/out_time_ms=(\d+)/g)].pop();
  if (ms) return Number(ms[1]) / 1_000_000;
  const clock = [...text.matchAll(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  return null;
}

export function parseMkvmergeProgress(text: string): number | null {
  const match = [...text.matchAll(/Progress:\s*(\d+(?:\.\d+)?)%/g)].pop();
  return match ? Math.min(1, Number(match[1]) / 100) : null;
}

export function scaleProgress(start: number, end: number, ratio: number): number {
  const r = Math.min(1, Math.max(0, ratio));
  return start + (end - start) * r;
}

function progressEmitter(
  onPhase?: (phase: "muxing" | "creating_stereo" | "transcoding" | "finishing", progress: number) => void,
): (phase: "muxing" | "creating_stereo" | "transcoding" | "finishing", progress: number) => void {
  let lastValue = -1;
  let lastAt = 0;
  return (phase, progress) => {
    const now = Date.now();
    if (progress < lastValue + 0.002 && now - lastAt < 400) return;
    lastValue = progress;
    lastAt = now;
    onPhase?.(phase, progress);
  };
}

async function run(
  bin: string,
  args: string[],
  opts?: { onChunk?: (text: string) => void; isCancelled?: () => boolean },
): Promise<void> {
  if (!opts?.onChunk && !opts?.isCancelled) {
    try {
      await execFileAsync(bin, args, { timeout: 0, maxBuffer: 2 * 1024 * 1024 });
      return;
    } catch (error) {
      const err = error as { message?: string; stderr?: string };
      throw new Error(formatToolError(bin, { message: err.message, stderr: err.stderr }));
    }
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const onCancel = setInterval(() => {
      if (opts.isCancelled?.()) child.kill("SIGTERM");
    }, 400);
    child.stdout.on("data", (buf: Buffer) => {
      opts.onChunk?.(buf.toString("utf8"));
    });
    child.stderr.on("data", (buf: Buffer) => {
      stderr = (stderr + buf.toString("utf8")).slice(-2_000_000);
    });
    child.on("error", (error) => {
      clearInterval(onCancel);
      reject(new Error(formatToolError(bin, { message: error.message, stderr })));
    });
    child.on("close", (code) => {
      clearInterval(onCancel);
      if (opts.isCancelled?.()) {
        reject(new CancelledError());
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(formatToolError(bin, { stderr })));
    });
  });
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
