import { describe, expect, it } from "vitest";
import { buildSuggestion, sizeCategory } from "./suggest.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import type { InspectionReport, LibraryItem } from "./types.ts";

const movie: LibraryItem = {
  id: "m1",
  instanceId: "radarr",
  instanceName: "Radarr 4K",
  arrId: 1,
  arrSeriesId: null,
  arrEpisodeFileId: null,
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
    sourceMethod: "ffprobe",
    listingState: "complete",
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

  it("marks a transcode when no hardware encoder is available", () => {
    const suggestion = buildSuggestion({
      item: movie,
      report: report({ hdr: "none" }),
      settings: DEFAULT_SETTINGS,
      sizeExempt: false,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
      hardwareAvailable: false,
    });

    expect(suggestion?.warning).toMatch(/Hardware encode is unavailable/);
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

  it("keeps non-preferred audio when automatic audio cleanup is disabled", () => {
    const suggestion = buildSuggestion({
      item: movie,
      report: report({ sizePerHourGb: 1, videoCodec: "hevc" }),
      settings: {
        ...DEFAULT_SETTINGS,
        suggestionDefaults: {
          ...DEFAULT_SETTINGS.suggestionDefaults,
          removeNonPreferredAudio: false,
        },
      },
      sizeExempt: true,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
    });
    expect(suggestion?.keepAudio).toEqual([1, 2]);
    expect(suggestion?.stripAudio).toEqual([]);
    expect(suggestion?.stripSubs).toEqual([3]);
    expect(suggestion?.reasons.some((reason) => /audio/i.test(reason))).toBe(false);
  });

  it("disables every automatic operation without disabling manual overrides", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      suggestionDefaults: {
        removeNonPreferredSubtitles: false,
        removeNonPreferredAudio: false,
        addStereo: false,
        transcodeToSizeCap: false,
      },
    };
    const automatic = buildSuggestion({
      item: movie,
      report: report(),
      settings,
      sizeExempt: false,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
    });
    const forcedStereo = buildSuggestion({
      item: movie,
      report: report({ sizePerHourGb: 1, videoCodec: "hevc" }),
      settings,
      sizeExempt: false,
      excluded: false,
      forceStereo: true,
      videoTarget: "hevc",
      av1Available: false,
    });
    const forcedTranscode = buildSuggestion({
      item: movie,
      report: report({ sizePerHourGb: 1 }),
      settings,
      sizeExempt: false,
      excluded: false,
      forceTranscode: true,
      videoTarget: "hevc",
      av1Available: false,
    });

    expect(automatic).toBeNull();
    expect(forcedStereo?.actions).toEqual(["add_stereo"]);
    expect(forcedTranscode?.actions).toEqual(["transcode"]);
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

  it("applies bulk size and track rules to a listed ISO report", () => {
    const iso = {
      ...movie,
      path: "/mnt/nas/discs/Example.iso",
      quality: "Bluray-1080p",
      resolution: "1080",
    };
    const listed = report({
      sourceMethod: "iso_ffmpeg",
      listingState: "complete",
      videoCodec: "mpeg2video",
      width: 1920,
      height: 1080,
      sizePerHourGb: 8,
      hdr: "none",
      bitDepth: 8,
    });
    const suggestion = buildSuggestion({
      item: iso,
      report: listed,
      settings: DEFAULT_SETTINGS,
      sizeExempt: false,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
    });
    expect(suggestion?.actions).toContain("transcode");
    expect(suggestion?.actions).toContain("tracks");
    expect(suggestion?.actions).toContain("add_stereo");
  });

  it("does not invent bulk work for an unlisted ISO", () => {
    const suggestion = buildSuggestion({
      item: { ...movie, path: "/mnt/nas/discs/Broken.iso" },
      report: report({ sourceMethod: "iso_ffmpeg", listingState: "iso_unlisted", videoCodec: "unknown", audio: [], subtitles: [], sizePerHourGb: 0, width: 0, height: 0 }),
      settings: DEFAULT_SETTINGS,
      sizeExempt: false,
      excluded: false,
      videoTarget: "hevc",
      av1Available: false,
    });
    expect(suggestion).toBeNull();
  });
});
