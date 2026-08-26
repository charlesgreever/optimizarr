import { describe, expect, it } from "vitest";
import { isTextSubtitleCodec } from "./optimize.ts";
import {
  applySubtitleLanguageToReport,
  detectSubtitleLanguageSample,
  detectTextLanguage,
  letterCount,
  plainTextFromSrt,
  SUB_SAMPLE_SEC,
  isPgsSubtitleCodec,
  pgsSampleArgs,
  subtitleSampleArgs,
  untaggedPgsSubtitle,
  untaggedTextSubtitle,
} from "./subtitle-language-id.ts";
import type { InspectionReport } from "./types.ts";

const englishSrt = `1
00:01:30,000 --> 00:01:34,000
The quick brown fox jumps over the lazy dog.

2
00:01:35,000 --> 00:01:40,000
Hello, how are you today? This is a longer sample of English dialogue from a movie scene.
`;

const germanSrt = `1
00:01:30,000 --> 00:01:36,000
Guten Tag, wie geht es Ihnen heute Abend?

2
00:01:37,000 --> 00:01:44,000
Das ist ein laengerer deutscher Text fuer die Spracherkennung in einem Film.
`;

function report(over: Partial<InspectionReport> = {}): InspectionReport {
  return {
    sourceSig: "p|1",
    sourceMethod: "ffprobe",
    listingState: "complete",
    durationSec: 7200,
    isoPlaylist: null,
    sizeBytes: 1,
    sizePerHourGb: 1,
    videoCodec: "hevc",
    width: 1920,
    height: 1080,
    bitDepth: 8,
    hdr: "none",
    audio: [],
    subtitles: [
      { index: 2, language: "und", codec: "subrip", title: "", untagged: true, forced: false, sdh: false },
      { index: 3, language: "und", codec: "hdmv_pgs_subtitle", title: "", untagged: true, forced: false, sdh: false },
    ],
    hasChapters: false,
    hasAttachments: false,
    ...over,
  };
}

describe("subtitle language identification", () => {
  it("strips SRT timestamps and detects English and German from the remaining words", () => {
    const english = plainTextFromSrt(englishSrt);
    expect(english).not.toMatch(/-->/);
    expect(letterCount(english)).toBeGreaterThan(80);
    expect(detectTextLanguage(english)?.language).toBe("eng");
    expect(detectTextLanguage(plainTextFromSrt(germanSrt))?.language).toBe("deu");
    expect(detectTextLanguage("1\n00:00:01,000 --> 00:00:02,000\nHi")).toBeNull();
  });

  it("detects English from noisy PGS OCR of a movie sample", () => {
    const ocr = `SEachsl Vainea mat ea Aare Reals ieee maa
nee?
Wait @ Minute, Wwnet @fe you Going, DOC?
Walla minute, Doo,
Whal, GO we become assnioves
RS YOURS, Wary,
Fey, 006, we beter back up,
ally! Wirt), | wanted fo show
Vvnat In Neu Was Tat?`;
    expect(letterCount(ocr)).toBeGreaterThan(80);
    expect(detectTextLanguage(ocr)?.language).toBe("eng");
  });

  it("builds a SubRip sample command and rejects image subtitle codecs", () => {
    const args = subtitleSampleArgs("/tmp/s.srt", 2, 90, ["-i", "/movie.mkv"]);
    expect(args).toContain("-c:s");
    expect(args).toContain("srt");
    expect(args[args.indexOf("-t") + 1]).toBe(String(SUB_SAMPLE_SEC));
    expect(args).toContain("0:2");
    expect(args.join(" ")).not.toMatch(/;|&&|\|/);
    expect(isTextSubtitleCodec("subrip")).toBe(true);
    expect(isTextSubtitleCodec("hdmv_pgs_subtitle")).toBe(false);
    expect(untaggedTextSubtitle(report(), 2)?.index).toBe(2);
    expect(untaggedTextSubtitle(report(), 3)).toBeNull();
    expect(untaggedTextSubtitle(report({
      subtitles: [{ index: 2, language: "any", codec: "subrip", title: "", untagged: false, forced: false, sdh: false }],
    }), 2)?.index).toBe(2);
    expect(isPgsSubtitleCodec("hdmv_pgs_subtitle")).toBe(true);
    const pgsArgs = pgsSampleArgs("/tmp/s.sup", 3, 90, ["-i", "/movie.mkv"]);
    expect(pgsArgs).toContain("copy");
    expect(pgsArgs.at(-1)).toBe("/tmp/s.sup");
    expect(pgsArgs.join(" ")).not.toMatch(/;|&&|\|/);
  });

  it("detects from an extracted sample and does not write until apply", async () => {
    const listed = report();
    const ok = await detectSubtitleLanguageSample({
      report: listed,
      trackIndex: 2,
      input: ["-i", "/movie.mkv"],
      extract: async () => englishSrt,
    });
    expect(ok).toMatchObject({ ok: true, language: "eng", languageName: "English", startSec: 90 });
    const weak = await detectSubtitleLanguageSample({
      report: listed,
      trackIndex: 2,
      startSec: 90,
      input: ["-i", "/movie.mkv"],
      extract: async () => "1\n00:00:01,000 --> 00:00:02,000\nHi\n",
    });
    expect(weak).toMatchObject({ ok: false, reason: "Not enough subtitle text in this sample.", startSec: 90 });
    const bitmap = await detectSubtitleLanguageSample({
      report: listed,
      trackIndex: 3,
      input: ["-i", "/movie.mkv"],
      extract: async () => {
        throw new Error("should not extract PGS");
      },
    });
    expect(bitmap).toMatchObject({ ok: false, status: 501 });
    const pgsOk = await detectSubtitleLanguageSample({
      report: listed,
      trackIndex: 3,
      input: ["-i", "/movie.mkv"],
      extract: async () => {
        throw new Error("should not extract SRT");
      },
      extractSup: async () => undefined,
      ocrPgs: async () => englishSrt,
      pgsOcrAvailable: true,
    });
    expect(pgsOk).toMatchObject({ ok: true, language: "eng", languageName: "English", startSec: 90 });
    expect(untaggedPgsSubtitle(listed, 3)?.index).toBe(3);
    const next = applySubtitleLanguageToReport(listed, 2, "en");
    expect("error" in next).toBe(false);
    if ("error" in next) return;
    expect(next.subtitles[0]).toMatchObject({ language: "eng", untagged: false, languagePending: true });
    const taggedPgs = applySubtitleLanguageToReport(listed, 3, "en");
    expect("error" in taggedPgs).toBe(false);
    if ("error" in taggedPgs) return;
    expect(taggedPgs.subtitles[1]).toMatchObject({ language: "eng", languagePending: true });
  });
});
