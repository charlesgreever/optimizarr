import type { InspectionReport } from "./types.ts";

type ProbeStream = {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  coded_width?: unknown;
  coded_height?: unknown;
  disposition?: unknown;
  tags?: unknown;
  channels?: unknown;
  bits_per_raw_sample?: unknown;
  pix_fmt?: unknown;
  color_transfer?: unknown;
  side_data_list?: unknown;
  index?: unknown;
};

export function parseFfprobe(path: string, sizeBytes: number, probe: Record<string, unknown>): InspectionReport {
  const format = asRecord(probe.format);
  const streams = Array.isArray(probe.streams) ? probe.streams.filter(isRecord) : [];
  const durationSec = numberOr(format.duration, 0);
  const video = pickPlayableVideo(streams);
  const width = intOr(video?.width, intOr(video?.coded_width, 0));
  const height = intOr(video?.height, intOr(video?.coded_height, 0));
  const audio = streams.filter((s) => s.codec_type === "audio").map(parseAudio);
  const subtitles = streams.filter((s) => s.codec_type === "subtitle").map(parseSub);
  const hours = durationSec > 0 ? durationSec / 3600 : 0;
  return {
    sourceSig: `${path}|${sizeBytes}`,
    durationSec,
    sizeBytes,
    sizePerHourGb: hours > 0 ? sizeBytes / (1024 ** 3) / hours : 0,
    videoCodec: stringOr(video?.codec_name, "unknown"),
    width,
    height,
    bitDepth: bitDepth(video),
    hdr: hdrKind(video, format),
    audio,
    subtitles,
    hasChapters: Array.isArray(probe.chapters) && probe.chapters.length > 0,
    hasAttachments: streams.some((s) => s.codec_type === "attachment"),
  };
}

export function pickPlayableVideo(streams: Record<string, unknown>[]): Record<string, unknown> | undefined {
  const videos = streams.filter((s) => s.codec_type === "video" && !isCoverArt(s));
  if (videos.length === 0) return streams.find((s) => s.codec_type === "video");
  return videos.sort((a, b) => area(b) - area(a))[0];
}

function isCoverArt(stream: Record<string, unknown>): boolean {
  const disp = asRecord(stream.disposition);
  if (disp.attached_pic === 1 || disp.attached_pic === "1") return true;
  return stringOr(stream.codec_name, "") === "mjpeg";
}

function area(stream: Record<string, unknown>): number {
  const w = intOr(stream.width, intOr(stream.coded_width, 0));
  const h = intOr(stream.height, intOr(stream.coded_height, 0));
  return w * h;
}

function parseAudio(stream: Record<string, unknown>, i: number): InspectionReport["audio"][number] {
  const tags = asRecord(stream.tags);
  const language = normalizeLang(stringOr(tags.language, "und"));
  const title = stringOr(tags.title, "");
  return {
    index: intOr(stream.index, i),
    language,
    channels: intOr(stream.channels, 2),
    codec: stringOr(stream.codec_name, "unknown"),
    title,
    untagged: language === "und",
    commentary: /comment/i.test(title),
  };
}

function parseSub(stream: Record<string, unknown>, i: number): InspectionReport["subtitles"][number] {
  const tags = asRecord(stream.tags);
  const language = normalizeLang(stringOr(tags.language, "und"));
  const title = stringOr(tags.title, "");
  const disp = asRecord(stream.disposition);
  return {
    index: intOr(stream.index, i),
    language,
    codec: stringOr(stream.codec_name, "unknown"),
    title,
    untagged: language === "und",
    forced: disp.forced === 1 || /forced/i.test(title),
    sdh: /sdh|hearing/i.test(title),
  };
}

function bitDepth(video: Record<string, unknown> | undefined): number {
  if (!video) return 8;
  const raw = intOr(video.bits_per_raw_sample, 0);
  if (raw) return raw;
  const pix = stringOr(video.pix_fmt, "");
  if (pix.includes("p10") || pix.includes("10le")) return 10;
  if (pix.includes("p12")) return 12;
  return 8;
}

function hdrKind(
  video: Record<string, unknown> | undefined,
  format: Record<string, unknown>,
): InspectionReport["hdr"] {
  const tags = { ...asRecord(video?.tags), ...asRecord(format.tags) };
  const blob = JSON.stringify({ video, tags }).toLowerCase();
  if (blob.includes("dolby") || blob.includes("dovi") || blob.includes("dvhe")) return "dolby_vision";
  if (blob.includes("hdr10+") || blob.includes("hdr10plus")) return "hdr10plus";
  const transfer = stringOr(video?.color_transfer, "").toLowerCase();
  if (transfer.includes("smpte2084") || transfer.includes("arib-std-b67") || blob.includes("hdr10")) return "hdr10";
  return "none";
}

export function normalizeLang(value: string): string {
  const v = value.toLowerCase();
  if (v === "en" || v === "eng" || v === "english") return "eng";
  if (v === "und" || v === "unknown" || v === "") return "und";
  return v.slice(0, 3);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intOr(value: unknown, fallback: number): number {
  return Math.round(numberOr(value, fallback));
}
