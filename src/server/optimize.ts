import { spawn } from "node:child_process";
import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pickEncoder, type EncodeBackends, detectBackends } from "./hardware.ts";
import { ffprobeFile, type InspectionReport } from "./inspect.ts";
import { parseFfmpegOutTime, ratioProgress, type ProgressUpdate } from "./progress.ts";
import { createStorage, type Transfer } from "./storage.ts";
import { isUntagged, type SuggestionPlan } from "./suggest.ts";
import { DEFAULT_SIZE_CAPS } from "./types.ts";

export type OptimizeResult = {
  sidecarPath: string;
  durationSec: number;
  sizeBytes: number;
};

export type RemuxRequest = {
  sourcePath: string;
  sidecarPath: string;
  plan: SuggestionPlan;
  report: InspectionReport;
  transfer?: Transfer;
  backends?: EncodeBackends;
  sizeCaps?: typeof DEFAULT_SIZE_CAPS;
  targetCodec?: "hevc" | "av1";
  signal?: AbortSignal;
  onProgress?: (update: ProgressUpdate) => void;
};

export type Optimizer = (req: RemuxRequest) => Promise<OptimizeResult>;

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

export function sidecarName(title: string, itemId: number): string {
  const safe = title.replace(/[^\w.-]+/g, "_").slice(0, 80);
  return `${safe}.${itemId}.mkv`;
}

export function assertIntegrity(source: InspectionReport, output: { durationSec: number; sizeBytes: number }): void {
  if (source.durationSec > 0 && output.durationSec < source.durationSec * 0.9) {
    throw new IntegrityError(`Duration mismatch ${output.durationSec} vs ${source.durationSec}`);
  }
  if (source.sizeBytes > 0 && output.sizeBytes < source.sizeBytes * 0.15) {
    throw new IntegrityError("Output is implausibly small");
  }
}

function transferFor(req: RemuxRequest): Transfer {
  return req.transfer ?? createStorage({
    copyMode: "auto",
    nasSshHost: "",
    nasSshUser: "",
    nasSshPort: 22,
    nasSshIdentityFile: "",
    nasPathMaps: [],
  });
}

export function copyOptimizer(): Optimizer {
  return async (req) => {
    await mkdir(dirname(req.sidecarPath), { recursive: true });
    const tmp = tempSidecarPath(req.sidecarPath);
    const transfer = transferFor(req);
    await copyWithProgress(req, transfer, req.sourcePath, tmp);
    const info = await stat(tmp);
    const result = {
      sidecarPath: req.sidecarPath,
      durationSec: req.report.durationSec,
      sizeBytes: info.size,
    };
    req.onProgress?.({ phase: "finishing", progress: 0 });
    assertIntegrity(req.report, result);
    await copyWithProgress(req, transfer, tmp, req.sidecarPath);
    await unlink(tmp).catch(() => undefined);
    return result;
  };
}

export function reviewPathFor(reviewRoot: string, title: string, itemId: number): string {
  return join(reviewRoot, sidecarName(title, itemId));
}

/** ffmpeg picks the muxer from the extension; a `.mkv.tmp` path is not Matroska. */
export function tempSidecarPath(sidecarPath: string): string {
  return sidecarPath.toLowerCase().endsWith(".mkv") ? `${sidecarPath.slice(0, -4)}.tmp.mkv` : `${sidecarPath}.tmp.mkv`;
}

export function remuxSidecarPath(sidecarPath: string): string {
  return sidecarPath.toLowerCase().endsWith(".mkv")
    ? `${sidecarPath.slice(0, -4)}.remux.tmp.mkv`
    : `${sidecarPath}.remux.tmp.mkv`;
}

function hardwareInputArgs(encoder: string): string[] {
  if (encoder.endsWith("_vaapi")) return ["-vaapi_device", "/dev/dri/renderD128"];
  return [];
}

function encodeQualityArgs(encoder: string, req: RemuxRequest): string[] {
  const caps = req.sizeCaps ?? DEFAULT_SIZE_CAPS;
  const cap = caps[req.plan.category] ?? caps.movie1080p;
  const bitsPerSec = Math.round((cap * 1024 ** 3 * 8) / 3600);
  const tenBit = (req.report.bitDepth ?? 8) >= 10;
  if (encoder.includes("nvenc")) {
    const args = [
      "-preset",
      "p5",
      "-rc",
      "vbr",
      "-b:v",
      String(bitsPerSec),
      "-maxrate",
      String(bitsPerSec),
      "-bufsize",
      String(bitsPerSec * 2),
    ];
    if (tenBit) args.push("-pix_fmt", "p010le");
    return args;
  }
  return [
    "-vf",
    tenBit ? "format=p010,hwupload" : "format=nv12,hwupload",
    "-b:v",
    String(bitsPerSec),
    "-maxrate",
    String(bitsPerSec),
  ];
}

async function probedDuration(path: string, fallback: number, requireProbe: boolean): Promise<number> {
  try {
    const report = await ffprobeFile(path, process.env.FFPROBE || "ffprobe");
    if (report.durationSec > 0) return report.durationSec;
  } catch {
    /* ffprobe missing or output is not media */
  }
  if (requireProbe) throw new IntegrityError("Could not read output duration");
  return fallback;
}

function usefulFfmpegLog(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => {
    if (/Skipping NAL unit/i.test(line)) return false;
    if (/Last message repeated/i.test(line)) return false;
    return line.trim().length > 0;
  });
  const errors = lines.filter((line) => /error|invalid|fail|unable|not supported|conversion|does not/i.test(line));
  const pick = (errors.length ? errors : lines).join(" ").replace(/\s+/g, " ").trim();
  return pick.length <= 800 ? pick : pick.slice(-800);
}

function ffmpegDetail(err: unknown): string {
  if (!err || typeof err !== "object") return err instanceof Error ? err.message : "";
  const rec = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const asText = (value: unknown) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && Buffer.isBuffer(value)) return value.toString("utf8");
    return "";
  };
  return usefulFfmpegLog(asText(rec.stderr) || asText(rec.stdout) || (typeof rec.message === "string" ? rec.message : ""));
}

/** Drain ffmpeg stdio so Dolby Vision NAL warnings cannot fill Node's 1MB execFile buffer and kill the encode. */
function runFfmpeg(
  bin: string,
  args: string[],
  opts?: { signal?: AbortSignal; onStdout?: (text: string) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { signal: opts?.signal });
    const chunks: string[] = [];
    let stored = 0;
    const keep = 16 * 1024;
    const take = (buf: Buffer) => {
      const text = buf.toString("utf8");
      chunks.push(text);
      stored += text.length;
      while (stored > keep && chunks.length > 1) {
        stored -= chunks[0].length;
        chunks.shift();
      }
    };
    child.stderr?.on("data", take);
    child.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      opts?.onStdout?.(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const err = new Error(`ffmpeg exited ${code}`) as Error & { stderr: string };
      err.stderr = usefulFfmpegLog(chunks.join(""));
      reject(err);
    });
  });
}

async function copyWithProgress(
  req: RemuxRequest,
  transfer: Transfer,
  src: string,
  dest: string,
): Promise<void> {
  await transfer.copy(src, dest, (copied, total) => {
    req.onProgress?.({
      phase: "copying",
      progress: ratioProgress(copied, total, { allowComplete: copied >= total && total > 0 }),
      copiedBytes: copied,
      totalBytes: total,
    });
  });
}

function uniqueLangs(langs: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lang of langs ?? []) {
    if (!lang || lang === "und") continue;
    if (seen.has(lang)) continue;
    seen.add(lang);
    out.push(lang);
  }
  return out;
}

function keepsUntagged(langs: string[] | undefined): boolean {
  return (langs ?? []).some((lang) => !lang || lang === "und");
}

function mapTrackArgs(
  kind: "a" | "s",
  keep: string[] | undefined,
  tracks: Array<{ language?: string }> | undefined,
  fallback: "all" | "first" | "none",
): string[] {
  const args: string[] = [];
  for (const lang of uniqueLangs(keep)) args.push("-map", `0:${kind}:m:language:${lang}`);
  if (keepsUntagged(keep)) {
    (tracks ?? []).forEach((track, i) => {
      if (isUntagged(track.language)) args.push("-map", `0:${kind}:${i}`);
    });
  }
  if (args.length) return args;
  if (kind === "a" && fallback === "all") return ["-map", "0:a?"];
  if (kind === "a" && fallback === "first") return ["-map", "0:a:0"];
  return [];
}

function trackMatchesKeep(track: { language?: string }, keepLangs: string[]): boolean {
  const lang = track.language?.toLowerCase();
  if (!lang) return false;
  return keepLangs.some((keep) => {
    const k = keep.toLowerCase();
    return lang === k || lang.startsWith(k) || k.startsWith(lang);
  });
}

function mappedAudioCount(
  keep: string[] | undefined,
  tracks: Array<{ language?: string }> | undefined,
  fallback: "all" | "first" | "none",
): number {
  const list = tracks ?? [];
  const langs = uniqueLangs(keep);
  let n = 0;
  for (const track of list) {
    if (trackMatchesKeep(track, langs)) n += 1;
    else if (keepsUntagged(keep) && isUntagged(track.language)) n += 1;
  }
  if (n > 0) return n;
  if (langs.length) return 1;
  if (fallback === "all") return list.length || 1;
  if (fallback === "first") return 1;
  return 0;
}

function stereoArgs(outputIndex: number): string[] {
  const i = String(Math.max(outputIndex, 0));
  return ["-map", "0:a:0", `-c:a:${i}`, "aac", `-ac:a:${i}`, "2", `-b:a:${i}`, "192k"];
}

function commonFfmpegIn(sourcePath: string): string[] {
  return ["-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-nostats", "-i", sourcePath];
}

function remuxArgs(req: RemuxRequest, sourcePath: string, dest: string, addStereo: boolean): string[] {
  const fallback = req.plan.actions.includes("remux") ? "first" : "all";
  return [
    ...commonFfmpegIn(sourcePath),
    "-map",
    "0:v:0",
    ...mapTrackArgs("a", req.plan.keepAudio, req.report.audio, fallback),
    ...mapTrackArgs("s", req.plan.keepSubs, req.report.subtitles, "none"),
    "-map",
    "0:t?",
    "-map_chapters",
    "0",
    "-c",
    "copy",
    ...(addStereo ? stereoArgs(mappedAudioCount(req.plan.keepAudio, req.report.audio, fallback)) : []),
    dest,
  ];
}

function encodeArgs(req: RemuxRequest, sourcePath: string, dest: string, alreadyRemuxed: boolean): string[] {
  const backends = req.backends ?? detectBackends();
  const codec = req.targetCodec === "av1" ? "av1" : "hevc";
  const encoder = pickEncoder(backends, codec);
  const maps = alreadyRemuxed
    ? ["-map", "0"]
    : [
        "-map",
        "0:v:0",
        ...mapTrackArgs("a", req.plan.keepAudio, req.report.audio, "all"),
        ...mapTrackArgs("s", req.plan.keepSubs, req.report.subtitles, "none"),
        "-map",
        "0:t?",
        "-map_chapters",
        "0",
      ];
  return [
    ...commonFfmpegIn(sourcePath),
    ...maps,
    ...hardwareInputArgs(encoder),
    "-c:v",
    encoder,
    ...encodeQualityArgs(encoder, req),
    "-c:a",
    "copy",
    "-c:s",
    "copy",
    "-c:t",
    "copy",
    ...(req.plan.actions.includes("add_stereo")
      ? stereoArgs(
          mappedAudioCount(
            req.plan.keepAudio,
            req.report.audio,
            alreadyRemuxed && req.plan.actions.includes("remux") ? "first" : "all",
          ),
        )
      : []),
    dest,
  ];
}

function onFfmpegProgress(req: RemuxRequest, phase: "remuxing" | "transcoding"): (text: string) => void {
  let leftover = "";
  return (text) => {
    leftover += text;
    const parts = leftover.split(/\r?\n/);
    leftover = parts.pop() ?? "";
    for (const line of parts) {
      const outTimeSec = parseFfmpegOutTime(`${line}\n`);
      if (outTimeSec == null) continue;
      req.onProgress?.({
        phase,
        progress: ratioProgress(outTimeSec, req.report.durationSec),
        outTimeSec,
        durationSec: req.report.durationSec,
      });
    }
  };
}

async function runOptimizePass(
  ffmpeg: string,
  req: RemuxRequest,
  args: string[],
  dest: string,
  phase: "remuxing" | "transcoding",
): Promise<void> {
  req.onProgress?.({ phase, progress: 0, durationSec: req.report.durationSec });
  try {
    await runFfmpeg(ffmpeg, args, { signal: req.signal, onStdout: onFfmpegProgress(req, phase) });
  } catch (err) {
    await unlink(dest).catch(() => undefined);
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError") {
      throw err;
    }
    const detail = ffmpegDetail(err);
    const kind = phase === "transcoding" ? "Hardware encode failed" : "Remux failed";
    throw new Error(detail ? `${kind}: ${detail}` : kind);
  }
}

export function ffmpegOptimizer(ffmpeg = process.env.FFMPEG || "ffmpeg"): Optimizer {
  return async (req) => {
    await mkdir(dirname(req.sidecarPath), { recursive: true });
    const tmp = tempSidecarPath(req.sidecarPath);
    const remuxTmp = remuxSidecarPath(req.sidecarPath);
    const remux = req.plan.actions.includes("remux");
    const encode = req.plan.actions.includes("transcode");
    try {
      if (remux && encode) {
        await runOptimizePass(ffmpeg, req, remuxArgs(req, req.sourcePath, remuxTmp, false), remuxTmp, "remuxing");
        await runOptimizePass(ffmpeg, req, encodeArgs(req, remuxTmp, tmp, true), tmp, "transcoding");
      } else if (encode) {
        await runOptimizePass(ffmpeg, req, encodeArgs(req, req.sourcePath, tmp, false), tmp, "transcoding");
      } else {
        await runOptimizePass(
          ffmpeg,
          req,
          remuxArgs(req, req.sourcePath, tmp, req.plan.actions.includes("add_stereo")),
          tmp,
          "remuxing",
        );
      }
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      await unlink(remuxTmp).catch(() => undefined);
      throw err;
    }
    req.onProgress?.({ phase: "finishing", progress: 0 });
    const info = await stat(tmp);
    const durationSec = await probedDuration(tmp, req.report.durationSec, encode);
    const result = { sidecarPath: req.sidecarPath, durationSec, sizeBytes: info.size };
    assertIntegrity(req.report, result);
    await copyWithProgress(req, transferFor(req), tmp, req.sidecarPath);
    await unlink(tmp).catch(() => undefined);
    await unlink(remuxTmp).catch(() => undefined);
    return result;
  };
}
