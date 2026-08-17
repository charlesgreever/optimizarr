import { describe, expect, it } from "vitest";
import { parseFfprobe } from "./inspect.ts";
import { buildSuggestion, explainSuggestion } from "./suggest.ts";
import { defaultSettings } from "./types.ts";

function report(streams: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return parseFfprobe("/f.mkv", {
    format: { duration: "3600", size: String(1.2 * 1024 ** 3), ...extra.format },
    streams,
  });
}

const settings = defaultSettings();
settings.languageConfirmed = true;

describe("suggestion engine", () => {
  it.each([
    {
      name: "healthy HEVC under cap with only preferred tracks is hidden",
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
      ],
      want: { healthy: true, actions: [] as string[] },
    },
    {
      name: "H.264 gets a transcode even when under the cap",
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
      ],
      want: { healthy: false, actions: ["transcode"] },
    },
    {
      name: "HEVC under cap with extra languages is remux-only",
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "spa" } },
        { codec_type: "subtitle", codec_name: "subrip", tags: { language: "fra" } },
        { codec_type: "subtitle", codec_name: "subrip", tags: { language: "eng" } },
      ],
      want: { healthy: false, actions: ["remux"], extraTracks: true },
    },
    {
      name: "AV1 is never suggested back to HEVC",
      streams: [
        { codec_type: "video", codec_name: "av1", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "deu" } },
      ],
      want: { healthy: false, actions: ["remux"] },
    },
    {
      name: "untagged tracks are stripped",
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
        { codec_type: "subtitle", codec_name: "subrip" },
      ],
      want: { extraTracks: true, actions: ["remux"] },
    },
  ])("$name", ({ streams, want }) => {
    const plan = buildSuggestion(report(streams), settings, "movie");
    expect(plan.actions).toEqual(want.actions);
    if (want.healthy !== undefined) expect(plan.healthy).toBe(want.healthy);
    if (want.extraTracks !== undefined) expect(plan.extraTracks).toBe(want.extraTracks);
  });

  it("uses movie vs TV size caps and estimates savings when over cap", () => {
    const big = report(
      [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }],
      { format: { duration: "3600", size: String(8 * 1024 ** 3) } },
    );
    const movie = buildSuggestion(big, settings, "movie");
    expect(movie.overCap).toBe(true);
    expect(movie.category).toBe("movie1080p");
    expect(movie.estimatedSavingsBytes).toBeGreaterThan(0);

    const tvSettings = defaultSettings();
    const tv = buildSuggestion(
      report(
        [{ codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 }],
        { format: { duration: "3600", size: String(3 * 1024 ** 3) } },
      ),
      tvSettings,
      "episode",
    );
    expect(tv.category).toBe("tv1080p");
    expect(tv.overCap).toBe(true);
    expect(tv.actions).toContain("transcode");
  });

  it("warns when transcoding Dolby Vision", () => {
    const plan = buildSuggestion(
      parseFfprobe("/dv.mkv", {
        format: { duration: "3600", size: String(20 * 1024 ** 3) },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 3840,
            height: 2160,
            side_data_list: [{ side_data_type: "DOVI configuration record" }],
          },
        ],
      }),
      settings,
      "movie",
    );
    expect(plan.actions).toContain("transcode");
    expect(plan.warning).toMatch(/Dolby Vision/i);
  });

  it("suggests AAC stereo for Atmos / >5.1 but not for stereo files", () => {
    const atmos = buildSuggestion(
      report([
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "truehd", channels: 8, tags: { language: "eng", title: "Atmos" } },
      ]),
      settings,
      "movie",
    );
    expect(atmos.actions).toContain("add_stereo");
    const stereo = buildSuggestion(
      report([
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
      ]),
      settings,
      "movie",
    );
    expect(stereo.actions).not.toContain("add_stereo");
    const forced = buildSuggestion(
      report([
        { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
        { codec_type: "audio", codec_name: "ac3", channels: 6, tags: { language: "eng" } },
      ]),
      settings,
      "movie",
      { addStereo: true },
    );
    expect(forced.actions).toContain("add_stereo");
  });

  it("can force work on a healthy file", () => {
    const healthy = report([
      { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080 },
      { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
    ]);
    expect(buildSuggestion(healthy, settings, "movie").healthy).toBe(true);
    expect(buildSuggestion(healthy, settings, "movie", { force: true }).actions).toEqual(["remux"]);
  });
});

describe("suggestion reasons and targets", () => {
  it.each([
    {
      name: "h264 under the cap converts to HEVC and does not invent a smaller size",
      actions: ["transcode"],
      overCap: false,
      extraTracks: false,
      videoCodec: "h264",
      size: 2 * 1024 ** 3,
      sizePerHourGb: 2,
      estimatedSavingsBytes: null,
      category: "movie1080p",
      quality: "Bluray-1080p",
      wantReasons: ["Video is H.264. Convert to HEVC."],
      wantAfter: { codec: "hevc", sizeBytes: null, sizePerHourGb: null },
    },
    {
      name: "already-HEVC over the cap shows current vs allowed GB/hr",
      actions: ["transcode"],
      overCap: true,
      extraTracks: false,
      videoCodec: "hevc",
      size: 8 * 1024 ** 3,
      sizePerHourGb: 8,
      estimatedSavingsBytes: 5.5 * 1024 ** 3,
      category: "movie1080p",
      wantReasons: ["Over the size cap: 8.00 GB/hr now, 2.50 GB/hr allowed."],
      wantAfter: { codec: "hevc", sizeBytes: 2.5 * 1024 ** 3, sizePerHourGb: 2.5 },
    },
    {
      name: "remux with extra tracks explains cleanup and does not invent a size",
      actions: ["remux"],
      overCap: false,
      extraTracks: true,
      videoCodec: "hevc",
      size: 3 * 1024 ** 3,
      sizePerHourGb: 1.2,
      estimatedSavingsBytes: null,
      category: "movie1080p",
      wantReasons: ["Keep the video; drop extra audio and subtitle tracks."],
      wantAfter: { codec: "hevc", sizeBytes: null, sizePerHourGb: null },
    },
    {
      name: "forced remux without extra tracks does not claim track cleanup",
      actions: ["remux"],
      overCap: false,
      extraTracks: false,
      videoCodec: "hevc",
      size: 3 * 1024 ** 3,
      sizePerHourGb: 1.2,
      estimatedSavingsBytes: null,
      category: "movie1080p",
      wantReasons: [] as string[],
      wantAfter: { codec: "hevc", sizeBytes: null, sizePerHourGb: null },
    },
    {
      name: "add stereo explains the AAC track",
      actions: ["add_stereo"],
      overCap: false,
      extraTracks: false,
      videoCodec: "hevc",
      size: 2 * 1024 ** 3,
      sizePerHourGb: 1,
      estimatedSavingsBytes: null,
      category: "movie1080p",
      wantReasons: ["Add a stereo AAC track."],
      wantAfter: { codec: "hevc", sizeBytes: null, sizePerHourGb: null },
    },
  ])("$name", ({ wantReasons, wantAfter, ...input }) => {
    const explained = explainSuggestion(input, settings);
    expect(explained.reasons).toEqual(wantReasons);
    expect(explained.after.codec).toBe(wantAfter.codec);
    expect(explained.after.sizePerHourGb).toBe(wantAfter.sizePerHourGb);
    if (wantAfter.sizeBytes == null) expect(explained.after.sizeBytes).toBeNull();
    else expect(explained.after.sizeBytes).toBeCloseTo(wantAfter.sizeBytes);
    expect(explained.now.codec).toBe(input.videoCodec);
    if ("quality" in input && input.quality) expect(explained.now.quality).toBe(input.quality);
  });
});
