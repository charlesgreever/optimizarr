import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SizeCaps } from "./types.ts";

const execFileAsync = promisify(execFile);

export type MediaTrack = {
  type: "video" | "audio" | "subtitle" | "attachment";
  codec?: string;
  language?: string;
  channels?: number;
  bitDepth?: number;
  width?: number;
  height?: number;
  atmos?: boolean;
};

export type InspectionReport = {
  path: string;
  durationSec: number;
  sizeBytes: number;
  videoCodec: string;
  bitDepth: number;
  width: number;
  height: number;
  hdr: "sdr" | "hdr10" | "hdr10plus" | "dolby_vision";
  audio: MediaTrack[];
  subtitles: MediaTrack[];
  attachments: number;
};

export type SizeCategory = keyof SizeCaps;

export function parseFfprobe(path: string, probe: Record<string, unknown>): InspectionReport {
  const format = (probe.format ?? {}) as Record<string, unknown>;
  const streams = Array.isArray(probe.streams) ? (probe.streams as Record<string, unknown>[]) : [];
  const video = streams.find((s) => s.codec_type === "video") ?? {};
  const tags = (video.tags ?? {}) as Record<string, string>;
  const audio = streams.filter((s) => s.codec_type === "audio").map(mapTrack);
  const subtitles = streams.filter((s) => s.codec_type === "subtitle").map(mapTrack);
  const attachments = streams.filter((s) => s.codec_type === "attachment").length;
  const width = Number(video.width ?? 0);
  const height = Number(video.height ?? 0);
  return {
    path,
    durationSec: Number(format.duration ?? 0),
    sizeBytes: Number(format.size ?? 0),
    videoCodec: normalizeCodec(String(video.codec_name ?? "")),
    bitDepth: Number(video.bits_per_raw_sample ?? bitsFromPix(String(video.pix_fmt ?? "")) ?? 8),
    width,
    height,
    hdr: detectHdr(video, tags),
    audio,
    subtitles,
    attachments,
  };
}

function mapTrack(s: Record<string, unknown>): MediaTrack {
  const tags = (s.tags ?? {}) as Record<string, string>;
  const lang = (tags.language || tags.LANGUAGE || "").toLowerCase();
  const title = `${tags.title ?? ""} ${s.codec_name ?? ""}`.toLowerCase();
  return {
    type: s.codec_type as MediaTrack["type"],
    codec: String(s.codec_name ?? ""),
    language: lang || undefined,
    channels: Number(s.channels ?? 0) || undefined,
    atmos: title.includes("atmos") || String(s.profile ?? "").toLowerCase().includes("atmos"),
  };
}

function normalizeCodec(name: string): string {
  const n = name.toLowerCase();
  if (n === "h264" || n === "avc1" || n === "avc") return "h264";
  if (n === "hevc" || n === "h265" || n === "hev1" || n === "hvc1") return "hevc";
  if (n === "av1" || n === "av01") return "av1";
  return n;
}

function bitsFromPix(pix: string): number | undefined {
  if (pix.includes("p10") || pix.includes("10le")) return 10;
  if (pix.includes("p12")) return 12;
  if (pix.includes("p8") || pix.includes("yuv420p")) return 8;
  return undefined;
}

function detectHdr(video: Record<string, unknown>, tags: Record<string, string>): InspectionReport["hdr"] {
  const blob = JSON.stringify({ video, tags }).toLowerCase();
  if (blob.includes("dolby") || blob.includes("dovi") || blob.includes("dvhe")) return "dolby_vision";
  if (blob.includes("hdr10+")) return "hdr10plus";
  if (blob.includes("smpte2084") || blob.includes("hdr10") || blob.includes("bt2020")) return "hdr10";
  return "sdr";
}

export function sizeCategory(
  type: "movie" | "episode",
  report: Pick<InspectionReport, "width" | "height" | "hdr">,
): SizeCategory {
  const uhd = report.height >= 2160 || report.width >= 3840;
  if (type === "episode") return uhd ? "tv4k" : "tv1080p";
  if (uhd) return report.hdr === "sdr" ? "movie4kSdr" : "movie4kHdr";
  return "movie1080p";
}

export function sizePerHourGb(report: Pick<InspectionReport, "sizeBytes" | "durationSec">): number | null {
  if (report.durationSec <= 0 || report.sizeBytes <= 0) return null;
  return report.sizeBytes / report.durationSec * 3600 / 1024 ** 3;
}

export async function ffprobeFile(path: string, ffprobe = "ffprobe"): Promise<InspectionReport> {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    path,
  ]);
  return parseFfprobe(path, JSON.parse(stdout) as Record<string, unknown>);
}
