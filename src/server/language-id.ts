import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InspectionReport } from "./types.ts";

export const LID_CLIP_SEC = 45;
export const LID_MIN_PROBABILITY = 0.75;
export const LID_DEFAULT_START_SEC = 90;
export const LID_RETRY_GAP_SEC = 600;

const WHISPER_TO_MATROSKA: Record<string, string> = {
  en: "eng",
  eng: "eng",
  english: "eng",
  de: "deu",
  deu: "deu",
  ger: "deu",
  german: "deu",
  es: "spa",
  spa: "spa",
  spanish: "spa",
  fr: "fra",
  fra: "fra",
  fre: "fra",
  french: "fra",
  it: "ita",
  ita: "ita",
  italian: "ita",
  ja: "jpn",
  jpn: "jpn",
  japanese: "jpn",
  ko: "kor",
  kor: "kor",
  korean: "kor",
  zh: "zho",
  zho: "zho",
  chi: "zho",
  chinese: "zho",
  pt: "por",
  por: "por",
  portuguese: "por",
  ru: "rus",
  rus: "rus",
  russian: "rus",
  nl: "nld",
  nld: "nld",
  dut: "nld",
  dutch: "nld",
  pl: "pol",
  pol: "pol",
  polish: "pol",
  sv: "swe",
  swe: "swe",
  swedish: "swe",
  da: "dan",
  dan: "dan",
  danish: "dan",
  no: "nor",
  nor: "nor",
  norwegian: "nor",
  fi: "fin",
  fin: "fin",
  finnish: "fin",
  tr: "tur",
  tur: "tur",
  turkish: "tur",
  ar: "ara",
  ara: "ara",
  arabic: "ara",
  hi: "hin",
  hin: "hin",
  hindi: "hin",
  cs: "ces",
  ces: "ces",
  cze: "ces",
  el: "ell",
  ell: "ell",
  gre: "ell",
  he: "heb",
  heb: "heb",
  hebrew: "heb",
  hu: "hun",
  hun: "hun",
  hungarian: "hun",
  ro: "ron",
  ron: "ron",
  rum: "ron",
  uk: "ukr",
  ukr: "ukr",
  ukrainian: "ukr",
  vi: "vie",
  vie: "vie",
  vietnamese: "vie",
  th: "tha",
  tha: "tha",
  thai: "tha",
  id: "ind",
  ind: "ind",
  indonesian: "ind",
};

const LANGUAGE_NAME: Record<string, string> = {
  eng: "English",
  deu: "German",
  spa: "Spanish",
  fra: "French",
  ita: "Italian",
  jpn: "Japanese",
  kor: "Korean",
  zho: "Chinese",
  por: "Portuguese",
  rus: "Russian",
  nld: "Dutch",
  pol: "Polish",
  swe: "Swedish",
  dan: "Danish",
  nor: "Norwegian",
  fin: "Finnish",
  tur: "Turkish",
  ara: "Arabic",
  hin: "Hindi",
  ces: "Czech",
  ell: "Greek",
  heb: "Hebrew",
  hun: "Hungarian",
  ron: "Romanian",
  ukr: "Ukrainian",
  vie: "Vietnamese",
  tha: "Thai",
  ind: "Indonesian",
};

export type LidResult = { language: string; probability: number };

export function languageFromWhisper(code: string): string | null {
  const mapped = WHISPER_TO_MATROSKA[code.trim().toLowerCase()];
  return mapped ?? null;
}

export function languageDisplayName(language: string): string {
  return LANGUAGE_NAME[language] ?? language;
}

export function defaultLanguageClipStart(durationSec: number): number {
  if (!(durationSec > LID_CLIP_SEC)) return 0;
  return Math.min(LID_DEFAULT_START_SEC, Math.max(0, durationSec - LID_CLIP_SEC));
}

export function suggestedNextStart(startSec: number, durationSec: number): number {
  const maxStart = Math.max(0, durationSec - LID_CLIP_SEC);
  const next = startSec + LID_RETRY_GAP_SEC;
  return Math.min(maxStart, Math.max(0, next));
}

export function languageClipArgs(
  dest: string,
  trackIndex: number,
  startSec: number,
  input: string[],
): string[] {
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
    String(LID_CLIP_SEC),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    dest,
  ];
}

export function parseLidJson(text: string): LidResult | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const language = typeof row.language === "string" ? languageFromWhisper(row.language) : null;
  const probability = typeof row.probability === "number" && Number.isFinite(row.probability) ? row.probability : null;
  if (!language || probability == null) return null;
  return { language, probability };
}

export function lidDecision(result: LidResult | null): "ok" | "no_speech" {
  if (!result || result.probability < LID_MIN_PROBABILITY) return "no_speech";
  return "ok";
}

export function untaggedAudioTrack(report: InspectionReport, trackIndex: number): InspectionReport["audio"][number] | null {
  const track = report.audio.find((row) => row.index === trackIndex);
  if (!track || track.channels <= 0) return null;
  if (track.language !== "und" && !track.untagged) return null;
  return track;
}

export function applyLanguageToReport(
  report: InspectionReport,
  trackIndex: number,
  language: string,
): InspectionReport | { error: string } {
  const mapped = languageFromWhisper(language) ?? (LANGUAGE_NAME[language] ? language : null);
  if (!mapped) return { error: "That language code is not supported." };
  if (!untaggedAudioTrack(report, trackIndex)) {
    return { error: "That track is not an untagged soundtrack." };
  }
  return {
    ...report,
    audio: report.audio.map((track) =>
      track.index === trackIndex ? { ...track, language: mapped, untagged: false } : track,
    ),
  };
}

export type LanguageDetectOk = {
  ok: true;
  language: string;
  languageName: string;
  probability: number;
  startSec: number;
  durationSec: number;
};

export type LanguageDetectFail = {
  ok: false;
  reason: string;
  startSec?: number;
  suggestedNextSec?: number;
  durationSec?: number;
  status: number;
};

export type LanguageDetectOptions = {
  report: InspectionReport;
  trackIndex: number;
  startSec?: number;
  input: string[];
  whisperAvailable: boolean;
  extract: (args: string[]) => Promise<void>;
  runLid: (clipPath: string) => Promise<string>;
};

export async function detectLanguageClip(opts: LanguageDetectOptions): Promise<LanguageDetectOk | LanguageDetectFail> {
  if (!opts.whisperAvailable) {
    return { ok: false, reason: "Language identification is not installed.", status: 501 };
  }
  if (!untaggedAudioTrack(opts.report, opts.trackIndex)) {
    return { ok: false, reason: "That track is not an untagged soundtrack.", status: 400 };
  }
  const startSec = opts.startSec == null ? defaultLanguageClipStart(opts.report.durationSec) : Math.max(0, Math.floor(opts.startSec));
  const dest = join(tmpdir(), `polisharr-lid-${randomUUID()}.wav`);
  const failed = (reason: string, status: number): LanguageDetectFail => ({
    ok: false,
    reason,
    startSec,
    suggestedNextSec: suggestedNextStart(startSec, opts.report.durationSec),
    durationSec: LID_CLIP_SEC,
    status,
  });
  try {
    try {
      await opts.extract(languageClipArgs(dest, opts.trackIndex, startSec, opts.input));
    } catch {
      return failed("ffmpeg could not extract a clip from this soundtrack.", 502);
    }
    let parsed: LidResult | null;
    try {
      parsed = parseLidJson(await opts.runLid(dest));
    } catch {
      return failed("Language identification could not run on this clip.", 502);
    }
    if (lidDecision(parsed) !== "ok" || !parsed) {
      return failed("No speech in this sample.", 200);
    }
    return {
      ok: true,
      language: parsed.language,
      languageName: languageDisplayName(parsed.language),
      probability: parsed.probability,
      startSec,
      durationSec: LID_CLIP_SEC,
    };
  } finally {
    await unlink(dest).catch(() => undefined); // extract may have failed before the clip existed
  }
}
