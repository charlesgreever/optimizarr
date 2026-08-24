import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { francAll } from "franc";
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
  const ranked = francAll(text);
  const top = ranked[0];
  if (!top || top[0] === "und") return null;
  const mapped = languageFromWhisper(top[0]);
  if (!mapped) return null;
  const score = typeof top[1] === "number" ? top[1] : 0;
  if (score < LID_MIN_PROBABILITY) return null;
  return { language: mapped, probability: score };
}

export function untaggedTextSubtitle(
  report: InspectionReport,
  trackIndex: number,
): InspectionReport["subtitles"][number] | null {
  const track = report.subtitles.find((row) => row.index === trackIndex);
  if (!track) return null;
  if (track.language !== "und" && !track.untagged) return null;
  if (!isTextSubtitleCodec(track.codec)) return null;
  return track;
}

export function applySubtitleLanguageToReport(
  report: InspectionReport,
  trackIndex: number,
  language: string,
): InspectionReport | { error: string } {
  const code = languageFromWhisper(language);
  if (!code) return { error: "That language code is not supported." };
  if (!untaggedTextSubtitle(report, trackIndex)) {
    return { error: "That track is not an untagged text subtitle." };
  }
  return {
    ...report,
    subtitles: report.subtitles.map((track) =>
      track.index === trackIndex ? { ...track, language: code, untagged: false } : track,
    ),
  };
}

export type SubtitleDetectOptions = {
  report: InspectionReport;
  trackIndex: number;
  startSec?: number;
  input: string[];
  extract: (args: string[]) => Promise<string>;
};

export async function detectSubtitleLanguageSample(
  opts: SubtitleDetectOptions,
): Promise<LanguageDetectOk | LanguageDetectFail> {
  const track = opts.report.subtitles.find((row) => row.index === opts.trackIndex);
  if (track && !isTextSubtitleCodec(track.codec)) {
    return { ok: false, reason: "This subtitle track is images, not text, so Polisharr cannot read a sample.", status: 400 };
  }
  if (!untaggedTextSubtitle(opts.report, opts.trackIndex)) {
    return { ok: false, reason: "That track is not an untagged text subtitle.", status: 400 };
  }
  const startSec = opts.startSec == null
    ? defaultLanguageClipStart(opts.report.durationSec)
    : Math.max(0, Math.floor(opts.startSec));
  const dest = join(tmpdir(), `polisharr-sub-${randomUUID()}.srt`);
  try {
    const srt = await opts.extract(subtitleSampleArgs(dest, opts.trackIndex, startSec, opts.input));
    const text = plainTextFromSrt(srt);
    const parsed = detectTextLanguage(text);
    if (!parsed) {
      return {
        ok: false,
        reason: "Not enough subtitle text in this sample.",
        startSec,
        suggestedNextSec: suggestedNextStart(startSec, opts.report.durationSec),
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
  } catch {
    return { ok: false, reason: "ffmpeg could not extract subtitle text from this track.", status: 502 };
  } finally {
    await unlink(dest).catch(() => undefined); // extract may have failed before the sample existed
  }
}
