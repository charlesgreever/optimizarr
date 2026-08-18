import { execFile } from "node:child_process";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { InspectionReport, Suggestion } from "./types.ts";
import { parseFfprobe } from "./inspect.ts";

const execFileAsync = promisify(execFile);

export type OptimizeRequest = {
  sourcePath: string;
  reviewDir: string;
  suggestion: Suggestion;
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

export function ffmpegOptimizer(): Optimizer {
  return async (req) => {
    if (req.backend === "none" && req.suggestion.actions.includes("transcode")) {
      throw new Error("Hardware encode is unavailable. Optimizarr will not fall back to a software encode.");
    }
    await mkdir(req.reviewDir, { recursive: true });
    const workDir = join(req.reviewDir, ".work");
    await mkdir(workDir, { recursive: true });
    const sidecarPath = join(req.reviewDir, `${basename(req.sourcePath).replace(/\.[^.]+$/, "")}.mkv`);
    const temps: string[] = [];
    try {
      let current = req.sourcePath;
      if (req.suggestion.actions.includes("tracks") || req.suggestion.actions.includes("add_stereo")) {
        if (req.suggestion.actions.includes("add_stereo")) {
          req.onPhase?.("creating_stereo", 0.1);
          const stereo = join(workDir, `${Date.now()}-stereo.aac`);
          temps.push(stereo);
          await run(req.ffmpeg, [
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-i",
            current,
            "-map",
            "0:a:0",
            "-ac",
            "2",
            "-c:a",
            "aac",
            "-b:a",
            req.conservative ? "128k" : "160k",
            stereo,
          ]);
          req.onPhase?.("muxing", 0.35);
          const muxed = join(workDir, `${Date.now()}-mux.mkv`);
          temps.push(muxed);
          await run(req.mkvmerge, muxArgs(current, muxed, req.suggestion, stereo));
          current = muxed;
        } else {
          req.onPhase?.("muxing", 0.2);
          const muxed = join(workDir, `${Date.now()}-mux.mkv`);
          temps.push(muxed);
          await run(req.mkvmerge, muxArgs(current, muxed, req.suggestion));
          current = muxed;
        }
      }
      if (req.suggestion.actions.includes("transcode")) {
        if (req.isCancelled?.()) throw new CancelledError();
        req.onPhase?.("transcoding", 0.5);
        const encoded = join(workDir, `${Date.now()}-enc.mkv`);
        temps.push(encoded);
        await run(req.ffmpeg, encodeArgs(current, encoded, req));
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

export class CancelledError extends Error {
  constructor() {
    super("The job was cancelled.");
    this.name = "CancelledError";
  }
}

export function muxArgs(source: string, dest: string, suggestion: Suggestion, stereo?: string): string[] {
  const args = ["-o", dest];
  if (suggestion.keepAudio.length) args.push("--audio-tracks", suggestion.keepAudio.join(","));
  if (suggestion.keepSubs.length) args.push("--subtitle-tracks", suggestion.keepSubs.join(","));
  args.push(source);
  if (stereo) args.push(stereo);
  return args;
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
  const encoder = req.target === "av1"
    ? req.backend === "vaapi" ? "av1_vaapi" : "av1_nvenc"
    : req.backend === "vaapi" ? "hevc_vaapi" : "hevc_nvenc";
  const hours = req.report.durationSec / 3600 || 1;
  const targetBytes = (req.suggestion.after.sizePerHourGb ?? 2.5) * hours * 1024 ** 3;
  const bitrate = Math.max(800_000, Math.round((targetBytes * 8) / Math.max(req.report.durationSec, 1)));
  const tenBit = req.report.bitDepth >= 10;
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", source];
  if (req.backend === "vaapi") args.push("-vaapi_device", "/dev/dri/renderD128");
  args.push("-c:v", encoder);
  if (tenBit && encoder.includes("nvenc")) args.push("-profile:v", "main10");
  args.push("-b:v", String(bitrate), "-pix_fmt", tenBit ? "p010le" : "yuv420p", "-c:a", "copy", "-c:s", "copy", dest);
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
