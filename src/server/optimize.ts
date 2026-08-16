import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { InspectionReport } from "./inspect.ts";
import { createStorage, type Transfer } from "./storage.ts";
import type { SuggestionPlan } from "./suggest.ts";

const execFileAsync = promisify(execFile);

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
    const tmp = `${req.sidecarPath}.tmp`;
    const transfer = transferFor(req);
    await transfer.copy(req.sourcePath, tmp);
    const info = await stat(tmp);
    const result = {
      sidecarPath: req.sidecarPath,
      durationSec: req.report.durationSec,
      sizeBytes: info.size,
    };
    assertIntegrity(req.report, result);
    await transfer.copy(tmp, req.sidecarPath);
    await unlink(tmp).catch(() => undefined);
    return result;
  };
}

export function reviewPathFor(reviewRoot: string, title: string, itemId: number): string {
  return join(reviewRoot, sidecarName(title, itemId));
}

function ffmpegDetail(err: unknown): string {
  if (!err || typeof err !== "object") return err instanceof Error ? err.message : "";
  const rec = err as { stderr?: unknown; stdout?: unknown; message?: unknown };
  const asText = (value: unknown) => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && Buffer.isBuffer(value)) return value.toString("utf8");
    return "";
  };
  return (asText(rec.stderr) || asText(rec.stdout) || (typeof rec.message === "string" ? rec.message : ""))
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 800);
}

export function ffmpegOptimizer(ffmpeg = process.env.FFMPEG || "ffmpeg"): Optimizer {
  return async (req) => {
    await mkdir(dirname(req.sidecarPath), { recursive: true });
    const tmp = `${req.sidecarPath}.tmp`;
    const args = ["-hide_banner", "-y", "-nostdin", "-i", req.sourcePath, "-map", "0:v:0"];
    for (const lang of req.plan.keepAudio ?? []) {
      if (lang && lang !== "und") args.push("-map", `0:a:m:language:${lang}`);
    }
    if (!req.plan.keepAudio?.length) args.push("-map", "0:a?");
    for (const lang of req.plan.keepSubs ?? []) {
      if (lang && lang !== "und") args.push("-map", `0:s:m:language:${lang}`);
    }
    args.push("-map", "0:t?");
    if (req.plan.actions.includes("transcode")) {
      args.push("-c:v", "hevc_nvenc", "-preset", "p5", "-rc", "constqp", "-qp", "22");
    } else {
      args.push("-c:v", "copy");
    }
    args.push("-c:a", "copy", "-c:s", "copy", "-c:t", "copy");
    if (req.plan.actions.includes("add_stereo")) {
      args.push("-map", "0:a:0", "-c:a:1", "aac", "-ac:a:1", "2", "-b:a:1", "192k");
    }
    args.push(tmp);
    try {
      await execFileAsync(ffmpeg, args);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      const detail = ffmpegDetail(err);
      const kind = req.plan.actions.includes("transcode") ? "Hardware encode failed" : "Remux failed";
      throw new Error(detail ? `${kind}: ${detail}` : kind);
    }
    const info = await stat(tmp);
    const result = { sidecarPath: req.sidecarPath, durationSec: req.report.durationSec, sizeBytes: info.size };
    assertIntegrity(req.report, result);
    await transferFor(req).copy(tmp, req.sidecarPath);
    await unlink(tmp).catch(() => undefined);
    return result;
  };
}
