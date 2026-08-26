import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { francAll } from "franc";
import { isUntaggedLanguage } from "./inspect.ts";
import { isTextSubtitleCodec } from "./optimize.ts";
import {
  defaultLanguageClipStart,
  languageDisplayName,
  languageFromWhisper,
  LID_MIN_PROBABILITY,
  suggestedNextStart,
  type LanguageDetectFail,
  type LanguageDetectOk,
} from "./language-id.ts";
import type { InspectionReport } from "./types.ts";

export const SUB_SAMPLE_SEC = 180;
export const SUB_MIN_LETTERS = 80;

export function isPgsSubtitleCodec(codec: string): boolean {
  return codec.toLowerCase().replace(/-/g, "_").includes("pgs");
}

export function pgsSampleArgs(dest: string, trackIndex: number, startSec: number, input: string[]): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss",
    String(Math.max(0, Math.floor(startSec))),
    ...input,
    "-map",
    `0:${trackIndex}`,
    "-t",
    String(SUB_SAMPLE_SEC),
    "-c:s",
    "copy",
    dest,
  ];
}

export function subtitleSampleArgs(dest: string, trackIndex: number, startSec: number, input: string[]): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss",
    String(Math.max(0, Math.floor(startSec))),
    ...input,
    "-map",
    `0:${trackIndex}`,
    "-t",
    String(SUB_SAMPLE_SEC),
    "-c:s",
    "srt",
    dest,
  ];
}

export function plainTextFromSrt(srt: string): string {
  const lines = srt.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (trimmed.includes("-->")) return false;
    return true;
  });
  return lines
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

export function detectTextLanguage(text: string): { language: string; probability: number } | null {
  if (letterCount(text) < SUB_MIN_LETTERS) return null;
  for (const row of francAll(text)) {
    const code = row[0];
    const score = typeof row[1] === "number" ? row[1] : 0;
    if (!code || code === "und") continue;
    const mapped = languageFromWhisper(code);
    if (!mapped) continue;
    if (score < LID_MIN_PROBABILITY) return null;
    return { language: mapped, probability: score };
  }
  return null;
}

export function untaggedTextSubtitle(
  report: InspectionReport,
  trackIndex: number,
): InspectionReport["subtitles"][number] | null {
  const track = untaggedSubtitle(report, trackIndex);
  if (!track || !isTextSubtitleCodec(track.codec)) return null;
  return track;
}

export function untaggedPgsSubtitle(
  report: InspectionReport,
  trackIndex: number,
): InspectionReport["subtitles"][number] | null {
  const track = untaggedSubtitle(report, trackIndex);
  if (!track || !isPgsSubtitleCodec(track.codec)) return null;
  return track;
}

function untaggedSubtitle(
  report: InspectionReport,
  trackIndex: number,
): InspectionReport["subtitles"][number] | null {
  const track = report.subtitles.find((row) => row.index === trackIndex);
  if (!track) return null;
  if (!isUntaggedLanguage(track.language) && !track.untagged) return null;
  return track;
}

export function applySubtitleLanguageToReport(
  report: InspectionReport,
  trackIndex: number,
  language: string,
): InspectionReport | { error: string } {
  const code = languageFromWhisper(language);
  if (!code) return { error: "That language code is not supported." };
  if (!untaggedTextSubtitle(report, trackIndex) && !untaggedPgsSubtitle(report, trackIndex)) {
    return { error: "That track is not an untagged subtitle." };
  }
  return {
    ...report,
    subtitles: report.subtitles.map((track) =>
      track.index === trackIndex ? { ...track, language: code, untagged: false, languagePending: true } : track,
    ),
  };
}

export type SubtitleDetectOptions = {
  report: InspectionReport;
  trackIndex: number;
  startSec?: number;
  input: string[];
  extract: (args: string[]) => Promise<string>;
  extractSup?: (args: string[]) => Promise<void>;
  ocrPgs?: (supPath: string) => Promise<string>;
  pgsOcrAvailable?: boolean;
};

export async function detectSubtitleLanguageSample(
  opts: SubtitleDetectOptions,
): Promise<LanguageDetectOk | LanguageDetectFail> {
  const track = opts.report.subtitles.find((row) => row.index === opts.trackIndex);
  const pgs = Boolean(track && isPgsSubtitleCodec(track.codec));
  if (track && !isTextSubtitleCodec(track.codec) && !pgs) {
    return { ok: false, reason: "This subtitle track is images, not text, so Polisharr cannot read a sample.", status: 400 };
  }
  if (pgs && !opts.pgsOcrAvailable) {
    return { ok: false, reason: "PGS language identification is not installed.", status: 501 };
  }
  if (pgs && !untaggedPgsSubtitle(opts.report, opts.trackIndex)) {
    return { ok: false, reason: "That track is not an untagged subtitle.", status: 400 };
  }
  if (!pgs && !untaggedTextSubtitle(opts.report, opts.trackIndex)) {
    return { ok: false, reason: "That track is not an untagged text subtitle.", status: 400 };
  }
  const startSec = opts.startSec == null
    ? defaultLanguageClipStart(opts.report.durationSec)
    : Math.max(0, Math.floor(opts.startSec));
  if (pgs) {
    return detectPgsLanguageSample(opts, startSec);
  }
  const dest = join(tmpdir(), `polisharr-sub-${randomUUID()}.srt`);
  try {
    const srt = await opts.extract(subtitleSampleArgs(dest, opts.trackIndex, startSec, opts.input));
    return languageFromSampleText(plainTextFromSrt(srt), startSec, opts.report.durationSec);
  } catch {
    return { ok: false, reason: "ffmpeg could not extract subtitle text from this track.", status: 502 };
  } finally {
    await unlink(dest).catch(() => undefined); // extract may have failed before the sample existed
  }
}

async function detectPgsLanguageSample(
  opts: SubtitleDetectOptions,
  startSec: number,
): Promise<LanguageDetectOk | LanguageDetectFail> {
  const dest = join(tmpdir(), `polisharr-pgs-${randomUUID()}.sup`);
  try {
    try {
      await opts.extractSup?.(pgsSampleArgs(dest, opts.trackIndex, startSec, opts.input));
    } catch {
      return { ok: false, reason: "ffmpeg could not extract a PGS sample from this track.", startSec, status: 502 };
    }
    let text = "";
    try {
      text = (await opts.ocrPgs?.(dest)) ?? "";
    } catch {
      return { ok: false, reason: "PGS language identification could not read this sample.", startSec, status: 502 };
    }
    return languageFromSampleText(text, startSec, opts.report.durationSec);
  } finally {
    await unlink(dest).catch(() => undefined); // extract may have failed before the sample existed
  }
}

function languageFromSampleText(
  text: string,
  startSec: number,
  durationSec: number,
): LanguageDetectOk | LanguageDetectFail {
  const parsed = detectTextLanguage(text);
  if (!parsed) {
    return {
      ok: false,
      reason: "Not enough subtitle text in this sample.",
      startSec,
      suggestedNextSec: suggestedNextStart(startSec, durationSec),
      durationSec: SUB_SAMPLE_SEC,
      status: 200,
    };
  }
  return {
    ok: true,
    language: parsed.language,
    languageName: languageDisplayName(parsed.language),
    probability: parsed.probability,
    startSec,
    durationSec: SUB_SAMPLE_SEC,
  };
}
