import { execFile } from "node:child_process";
import { copyFile, mkdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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

function muxArgs(source: string, dest: string, suggestion: Suggestion, stereo?: string): string[] {
  const args = ["-o", dest, source];
  const audio = suggestion.keepAudio;
  const subs = suggestion.keepSubs;
  if (audio.length) args.push("--audio-tracks", audio.join(","));
  if (subs.length) args.push("--subtitle-tracks", subs.join(","));
  if (stereo) args.push(stereo);
  return args;
}

function encodeArgs(source: string, dest: string, req: OptimizeRequest): string[] {
  const encoder = req.target === "av1"
    ? req.backend === "vaapi" ? "av1_vaapi" : "av1_nvenc"
    : req.backend === "vaapi" ? "hevc_vaapi" : "hevc_nvenc";
  const hours = req.report.durationSec / 3600 || 1;
  const targetBytes = (req.suggestion.after.sizePerHourGb ?? 2.5) * hours * 1024 ** 3;
  const bitrate = Math.max(800_000, Math.round((targetBytes * 8) / Math.max(req.report.durationSec, 1)));
  const args = ["-y", "-i", source];
  if (req.backend === "vaapi") args.push("-vaapi_device", "/dev/dri/renderD128");
  args.push("-c:v", encoder, "-b:v", String(bitrate), "-pix_fmt", req.report.bitDepth >= 10 ? "p010le" : "yuv420p", "-c:a", "copy", "-c:s", "copy", dest);
  return args;
}

async function run(bin: string, args: string[]): Promise<void> {
  await execFileAsync(bin, args, { timeout: 0, maxBuffer: 1024 * 256 });
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
