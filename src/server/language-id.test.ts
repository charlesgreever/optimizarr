import { describe, expect, it } from "vitest";
import {
  applyLanguageToReport,
  defaultLanguageClipStart,
  detectLanguageClip,
  languageClipArgs,
  languageFromWhisper,
  lidDecision,
  LID_CLIP_SEC,
  parseLidJson,
  suggestedNextStart,
  untaggedAudioTrack,
} from "./language-id.ts";
import type { InspectionReport } from "./types.ts";

describe("language identification helpers", () => {
  it("maps Whisper codes onto Matroska language tags", () => {
    expect(languageFromWhisper("en")).toBe("eng");
    expect(languageFromWhisper("DE")).toBe("deu");
    expect(languageFromWhisper("deu")).toBe("deu");
    expect(languageFromWhisper("und")).toBeNull();
    expect(languageFromWhisper("")).toBeNull();
    expect(languageFromWhisper("xx")).toBeNull();
  });

  it("builds a 45-second mono clip command without a shell string", () => {
    const args = languageClipArgs("/tmp/clip.wav", 1, 90, ["-i", "/mnt/nas/movie.mkv"]);
    expect(args).toContain("-ss");
    expect(args[args.indexOf("-ss") + 1]).toBe("90");
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe(String(LID_CLIP_SEC));
    expect(args).toContain("0:1");
    expect(args).toContain("16000");
    expect(args.join(" ")).not.toMatch(/;|&&|\|/);
  });

  it("skips opening logos on a long title and starts at zero on a short one", () => {
    expect(defaultLanguageClipStart(7200)).toBe(90);
    expect(defaultLanguageClipStart(30)).toBe(0);
    expect(suggestedNextStart(90, 7200)).toBe(690);
    expect(suggestedNextStart(7000, 7200)).toBe(7200 - LID_CLIP_SEC);
  });

  it("accepts high-confidence JSON and rejects a weak sample", () => {
    expect(parseLidJson('{"language":"en","probability":0.94}')).toEqual({ language: "eng", probability: 0.94 });
    expect(lidDecision({ language: "eng", probability: 0.94 })).toBe("ok");
    expect(lidDecision({ language: "eng", probability: 0.2 })).toBe("no_speech");
    expect(lidDecision(parseLidJson("not-json"))).toBe("no_speech");
  });

  it("applies a language only to an untagged soundtrack and leaves other tracks alone", () => {
    const report: InspectionReport = {
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
      audio: [
        { index: 1, language: "und", channels: 6, codec: "dts", title: "", untagged: true, commentary: false },
        { index: 2, language: "spa", channels: 2, codec: "aac", title: "", untagged: false, commentary: false },
      ],
      subtitles: [],
      hasChapters: false,
      hasAttachments: false,
    };
    expect(untaggedAudioTrack(report, 1)?.index).toBe(1);
    expect(untaggedAudioTrack(report, 2)).toBeNull();
    const next = applyLanguageToReport(report, 1, "en");
    expect("error" in next).toBe(false);
    if ("error" in next) return;
    expect(next.audio[0]).toMatchObject({ language: "eng", untagged: false });
    expect(next.audio[1]?.language).toBe("spa");
    expect(applyLanguageToReport(report, 2, "eng")).toEqual({ error: "That track is not an untagged soundtrack." });
  });

  it("detects English on a high-confidence clip and asks for another time on a weak clip", async () => {
    const report: InspectionReport = {
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
      audio: [{ index: 1, language: "und", channels: 6, codec: "dts", title: "", untagged: true, commentary: false }],
      subtitles: [],
      hasChapters: false,
      hasAttachments: false,
    };
    const ok = await detectLanguageClip({
      report,
      trackIndex: 1,
      input: ["-i", "/movie.mkv"],
      whisperAvailable: true,
      extract: async () => undefined,
      runLid: async () => JSON.stringify({ language: "en", probability: 0.94 }),
    });
    expect(ok).toMatchObject({ ok: true, language: "eng", languageName: "English", startSec: 90 });
    const weak = await detectLanguageClip({
      report,
      trackIndex: 1,
      startSec: 90,
      input: ["-i", "/movie.mkv"],
      whisperAvailable: true,
      extract: async () => undefined,
      runLid: async () => JSON.stringify({ language: "en", probability: 0.2 }),
    });
    expect(weak).toMatchObject({ ok: false, reason: "No speech in this sample.", startSec: 90, suggestedNextSec: 690 });
    const missing = await detectLanguageClip({
      report,
      trackIndex: 1,
      input: ["-i", "/movie.mkv"],
      whisperAvailable: false,
      extract: async () => undefined,
      runLid: async () => {
        throw new Error("should not run");
      },
    });
    expect(missing).toMatchObject({ ok: false, status: 501 });
  });
});
