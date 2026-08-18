import { describe, expect, it } from "vitest";
import { buildSuggestion, sizeCategory } from "./suggest.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import type { InspectionReport, LibraryItem } from "./types.ts";

const movie: LibraryItem = {
  id: "m1",
  instanceId: "radarr",
  instanceName: "Radarr 4K",
  arrId: 1,
  type: "movie",
  title: "Avatar",
  showTitle: null,
  season: null,
  episode: null,
  episodeTitle: null,
  path: "/mnt/nas/Avatar.mkv",
  sizeBytes: 16_000_000_000,
  quality: "WEBDL-2160p",
  resolution: "2160",
  profile: "Ultra-HD",
  tags: [],
  posterRemoteUrl: null,
  hasPoster: false,
  sizeExempt: false,
};

function report(over: Partial<InspectionReport> = {}): InspectionReport {
  return {
    sourceSig: "p|1",
    durationSec: 5900,
    sizeBytes: 16_000_000_000,
    sizePerHourGb: 9.8,
    videoCodec: "h264",
    width: 3840,
    height: 2160,
    bitDepth: 10,
    hdr: "dolby_vision",
    audio: [
      { index: 1, language: "eng", channels: 8, codec: "eac3", title: "Atmos", untagged: false, commentary: false },
      { index: 2, language: "spa", channels: 2, codec: "aac", title: "", untagged: false, commentary: false },
    ],
    subtitles: [{ index: 3, language: "spa", codec: "srt", title: "", untagged: false, forced: false, sdh: false }],
    hasChapters: true,
    hasAttachments: false,
    ...over,
  };
}

describe("suggestion engine", () => {
  it("scores a 2160p HDR movie against the 4K HDR cap", () => {
    expect(sizeCategory(movie, report())).toBe("movie4kHdr");
    const suggestion = buildSuggestion({
      item: movie,
      report: report(),
      settings: DEFAULT_SETTINGS,
      sizeExempt: false,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
    });
    expect(suggestion?.after.sizePerHourGb).toBe(8);
    expect(suggestion?.reasons.some((r) => r.includes("8.00"))).toBe(true);
    expect(suggestion?.warning).toMatch(/Dolby Vision/);
  });

  it("keeps preferred tracks and suggests stereo for Atmos", () => {
    const suggestion = buildSuggestion({
      item: movie,
      report: report({ sizePerHourGb: 1, videoCodec: "hevc" }),
      settings: DEFAULT_SETTINGS,
      sizeExempt: true,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
    });
    expect(suggestion?.actions).toContain("tracks");
    expect(suggestion?.actions).toContain("add_stereo");
    expect(suggestion?.actions).not.toContain("transcode");
    expect(suggestion?.keepAudio).toEqual([1]);
    expect(suggestion?.after.sizePerHourGb).toBeNull();
  });

  it("does not suggest HEVC for AV1 sources", () => {
    const suggestion = buildSuggestion({
      item: movie,
      report: report({ videoCodec: "av1", sizePerHourGb: 20 }),
      settings: DEFAULT_SETTINGS,
      sizeExempt: false,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
    });
    expect(suggestion?.actions ?? []).not.toContain("transcode");
  });
});
