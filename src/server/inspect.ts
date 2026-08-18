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

export function isInspectionReport(value: unknown): value is InspectionReport {
  return Boolean(value && typeof value === "object" && "width" in value && "videoCodec" in value && "sizeBytes" in value);
}

export function parseFfprobe(path: string, probe: Record<string, unknown>): InspectionReport {
  const format = (probe.format ?? {}) as Record<string, unknown>;
  const streams = Array.isArray(probe.streams) ? (probe.streams as Record<string, unknown>[]) : [];
  const video = primaryVideo(streams);
  const tags = (video.tags ?? {}) as Record<string, string>;
  const audio = streams.filter((s) => s.codec_type === "audio").map(mapTrack);
  const subtitles = streams.filter((s) => s.codec_type === "subtitle").map(mapTrack);
  const attachments = streams.filter((s) => s.codec_type === "attachment").length;
  const { width, height } = streamSize(video);
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

function streamSize(s: Record<string, unknown>): { width: number; height: number } {
  const width = Number(s.width ?? s.coded_width ?? 0);
  const height = Number(s.height ?? s.coded_height ?? 0);
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

function isAttachedPic(s: Record<string, unknown>): boolean {
  const disposition = (s.disposition ?? {}) as Record<string, unknown>;
  return Number(disposition.attached_pic) === 1;
}

function isCoverCodec(s: Record<string, unknown>): boolean {
  const codec = String(s.codec_name ?? "").toLowerCase();
  return codec === "mjpeg" || codec === "png" || codec === "bmp" || codec === "gif";
}

/** Prefer the largest playable video stream. Cover art is often stream 0. */
function primaryVideo(streams: Record<string, unknown>[]): Record<string, unknown> {
  const videos = streams.filter((s) => s.codec_type === "video");
  const playable = videos.filter((s) => !isAttachedPic(s) && !isCoverCodec(s));
  const pool = playable.length > 0 ? playable : videos.filter((s) => !isAttachedPic(s));
  const ranked = (pool.length > 0 ? pool : videos).slice().sort((a, b) => {
    const aSize = streamSize(a);
    const bSize = streamSize(b);
    return bSize.width * bSize.height - aSize.width * aSize.height;
  });
  return ranked[0] ?? {};
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

export type SizeHint = { resolution?: string | null; quality?: string | null; hdr?: string | null };

export function isUhdLabel(value: string | null | undefined): boolean {
  if (!value) return false;
  return /\b(2160|3840|4k|uhd)\b/i.test(value);
}

export function isUhdDimensions(width: number, height: number): boolean {
  return Math.max(width, height) >= 3840 || Math.min(width, height) >= 2160;
}

function hintedHdr(report: Pick<InspectionReport, "hdr">, hint?: SizeHint): InspectionReport["hdr"] {
  if (report.hdr && report.hdr !== "sdr") return report.hdr;
  const raw = (hint?.hdr ?? "").toLowerCase();
  if (raw.includes("dolby") || raw.includes("dovi") || raw === "dv") return "dolby_vision";
  if (raw.includes("hdr10+")) return "hdr10plus";
  if (raw.includes("hdr")) return "hdr10";
  return report.hdr ?? "sdr";
}

export function sizeCategory(
  type: "movie" | "episode",
  report: Pick<InspectionReport, "width" | "height" | "hdr">,
  hint?: SizeHint,
): SizeCategory {
  const uhd = isUhdDimensions(report.width, report.height) || isUhdLabel(hint?.resolution) || isUhdLabel(hint?.quality);
  if (type === "episode") return uhd ? "tv4k" : "tv1080p";
  if (uhd) return hintedHdr(report, hint) === "sdr" ? "movie4kSdr" : "movie4kHdr";
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
