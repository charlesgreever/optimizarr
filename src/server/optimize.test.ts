import { describe, expect, it } from "vitest";
import { audioAacArgs, encodeArgs, formatToolError, isoDemuxArgs, isoInputAttempts, isoRemuxArgs, muxArgs, optimizeSteps, planFromSuggestion } from "./optimize.ts";
import type { OptimizeRequest } from "./optimize.ts";
import type { InspectionReport, Suggestion } from "./types.ts";

const suggestion: Suggestion = {
  id: "s1",
  itemId: "m1",
  actions: ["tracks", "add_stereo"],
  reasons: [],
  warning: null,
  category: "movie4kHdr",
  estimatedSavingsBytes: null,
  now: { codec: "hevc", quality: "Bluray-2160p", sizeBytes: 1, sizePerHourGb: 8 },
  after: { codec: "hevc", quality: null, sizeBytes: null, sizePerHourGb: null },
  dismissed: false,
  keepAudio: [1, 2],
  stripAudio: [],
  keepSubs: [3, 4],
  stripSubs: [],
};

const source =
  "/mnt/nas/Kids Movies/Big Hero 6 (2014)/Big Hero 6 (2014) {imdb-tt2245084}[Bluray-2160p][HDR][10bit][HEVC][TrueHD Atmos 7.1].mkv";

describe("mkvmerge arguments", () => {
  it("keeps a parenthesized source path as one operand and applies track options to that file", () => {
    const args = muxArgs(source, "/mnt/nas/review-path/.work/out.mkv", suggestion, "/tmp/stereo.aac");
    expect(args).toContain(source);
    expect(args.filter((part) => part.includes("Big Hero 6")).length).toBe(1);
    const sourceAt = args.indexOf(source);
    const audioAt = args.indexOf("--audio-tracks");
    const subsAt = args.indexOf("--subtitle-tracks");
    const stereoAt = args.indexOf("/tmp/stereo.aac");
    expect(audioAt).toBeGreaterThan(-1);
    expect(audioAt).toBeLessThan(sourceAt);
    expect(subsAt).toBeLessThan(sourceAt);
    expect(stereoAt).toBeGreaterThan(sourceAt);
    expect(args.join(" ")).not.toContain("mkvmerge -o");
  });

  it("does not expose an unquoted command line when a tool fails", () => {
    const message = formatToolError("mkvmerge", {
      message: `Command failed: mkvmerge -o out.mkv ${source}`,
      stderr: "Error: The file could not be opened.",
    });
    expect(message).toContain("mkvmerge failed");
    expect(message).toContain("The file could not be opened.");
    expect(message).not.toContain("Command failed:");
  });

  it("skips the ffmpeg version banner and keeps the encoder error", () => {
    const message = formatToolError("ffmpeg", {
      stderr: [
        "ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2026 the FFmpeg developers",
        "built with gcc 12 (Debian 12.2.0-14)",
        "configuration: --enable-gpl",
        "libavutil      57. 28.100 / 57. 28.100",
        "Cannot load libnvidia-encode.so.1",
        "Error initializing output stream 0:0 -- Error while opening encoder for output stream #0:0 - maybe incorrect parameters such as bit_rate, rate, width or height",
      ].join("\n"),
    });
    expect(message).toContain("ffmpeg failed");
    expect(message).not.toMatch(/ffmpeg version 5\.1\.9/);
    expect(message).toMatch(/libnvidia-encode|opening encoder/i);
  });
});

describe("ffmpeg encode arguments", () => {
  it("hides the banner and uses a 10-bit NVENC profile", () => {
    const req = {
      sourcePath: source,
      reviewDir: "/tmp/review",
      suggestion,
      report: {
        sourceSig: "p|1",
        sourceMethod: "ffprobe",
        listingState: "complete",
        durationSec: 6000,
        sizeBytes: 20_000_000_000,
        sizePerHourGb: 12,
        videoCodec: "hevc",
        width: 3840,
        height: 2160,
        bitDepth: 10,
        hdr: "hdr10",
        audio: [],
        subtitles: [],
        hasChapters: false,
        hasAttachments: false,
      } satisfies InspectionReport,
      target: "hevc",
      backend: "cuda",
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      mkvmerge: "mkvmerge",
      conservative: false,
    } satisfies OptimizeRequest;
    const args = encodeArgs(source, "/tmp/out.mkv", req);
    expect(args.slice(0, 4)).toEqual(["-hide_banner", "-nostdin", "-loglevel", "error"]);
    expect(args).toContain("hevc_nvenc");
    expect(args).toContain("main10");
    expect(args).toContain("p010le");
  });

  it("uses quality controls instead of bitrate for quality mode", () => {
    const plan = planFromSuggestion(suggestion);
    const qualityReq = {
      sourcePath: source,
      reviewDir: "/tmp/review",
      suggestion,
      plan: {
        ...plan,
        video: { kind: "quality" as const, codec: "hevc" as const, quality: 22, downscale1080p: true, bitDepth: 10 },
      },
      report: {
        sourceSig: "p|1",
        sourceMethod: "ffprobe" as const,
        listingState: "complete" as const,
        durationSec: 6000,
        sizeBytes: 20_000_000_000,
        sizePerHourGb: 12,
        videoCodec: "hevc",
        width: 3840,
        height: 2160,
        bitDepth: 10,
        hdr: "hdr10" as const,
        audio: [],
        subtitles: [],
        hasChapters: false,
        hasAttachments: false,
      },
      target: "hevc" as const,
      backend: "cuda" as const,
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      mkvmerge: "mkvmerge",
      conservative: false,
    };
    const args = encodeArgs(source, "/tmp/out.mkv", qualityReq);
    expect(args).toContain("-cq");
    expect(args).not.toContain("-b:v");
    expect(args).toContain("scale=1920:1080");
  });

  it("encodes only the first video stream so Blu-ray menu titles do not hit NVENC", () => {
    const plan = planFromSuggestion({ ...suggestion, actions: ["transcode"] });
    const args = encodeArgs(source, "/tmp/out.mkv", {
      sourcePath: source,
      reviewDir: "/tmp/review",
      suggestion,
      plan,
      report: {
        sourceSig: "p|1",
        sourceMethod: "iso_ffmpeg",
        listingState: "complete",
        durationSec: 8500,
        sizeBytes: 25_000_000_000,
        sizePerHourGb: 10,
        videoCodec: "h264",
        width: 1920,
        height: 1080,
        bitDepth: 8,
        hdr: "none",
        audio: [],
        subtitles: [],
        hasChapters: false,
        hasAttachments: false,
      },
      target: "hevc",
      backend: "cuda",
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      mkvmerge: "mkvmerge",
      conservative: false,
    });
    expect(args).toContain("0:v:0");
    const maps = args.filter((part, i) => args[i - 1] === "-map");
    expect(maps).toContain("0:v:0");
    expect(maps.some((part) => part === "0" || part.startsWith("0:v:1"))).toBe(false);
  });

  it("picks NVENC bitrate from the target file size and the feature duration", () => {
    const targetBytes = 20 * 1024 ** 3;
    const durationSec = 8500;
    const args = encodeArgs("/tmp/hunger-games.mkv", "/tmp/out.mkv", {
      sourcePath: "/mnt/nas/Movies/The Hunger Games (2012)/The Hunger Games.iso",
      reviewDir: "/tmp/review",
      plan: {
        origin: "custom",
        video: { kind: "size", codec: "hevc", targetBytes, downscale1080p: false, bitDepth: 8 },
        audio: [],
        subtitles: [],
        container: "mkv",
        writeMode: "sidecar",
        warning: null,
        reasons: ["Target 20 GB"],
        estimatedOutputBytes: targetBytes,
        category: "movie1080p",
      },
      report: {
        sourceSig: "p|1",
        sourceMethod: "iso_ffmpeg",
        listingState: "complete",
        durationSec,
        sizeBytes: 40_000_000_000,
        sizePerHourGb: 16,
        videoCodec: "h264",
        width: 1920,
        height: 1080,
        bitDepth: 8,
        hdr: "none",
        audio: [],
        subtitles: [],
        hasChapters: false,
        hasAttachments: false,
      },
      target: "hevc",
      backend: "cuda",
      ffmpeg: "ffmpeg",
      ffprobe: "ffprobe",
      mkvmerge: "mkvmerge",
      conservative: false,
    });
    const bitrate = Number(args[args.indexOf("-b:v") + 1]);
    const expected = Math.round(((targetBytes - 80_000_000) * 8) / durationSec);
    expect(bitrate).toBe(expected);
    expect(bitrate).toBeGreaterThan(15_000_000);
    expect(bitrate).toBeLessThan(25_000_000);
  });

  it("does not invent a bitrate when duration is unknown", () => {
    expect(() =>
      encodeArgs("/tmp/hunger-games.mkv", "/tmp/out.mkv", {
        sourcePath: "/mnt/nas/Movies/The Hunger Games (2012)/The Hunger Games.iso",
        reviewDir: "/tmp/review",
        plan: {
          origin: "custom",
          video: { kind: "size", codec: "hevc", targetBytes: 20 * 1024 ** 3, downscale1080p: false, bitDepth: 8 },
          audio: [],
          subtitles: [],
          container: "mkv",
          writeMode: "sidecar",
          warning: null,
          reasons: ["Target 20 GB"],
          estimatedOutputBytes: 20 * 1024 ** 3,
          category: "movie1080p",
        },
        report: {
          sourceSig: "p|1",
          sourceMethod: "iso_ffmpeg",
          listingState: "complete",
          durationSec: 0,
          sizeBytes: 40_000_000_000,
          sizePerHourGb: 0,
          videoCodec: "h264",
          width: 1920,
          height: 1080,
          bitDepth: 8,
          hdr: "none",
          audio: [],
          subtitles: [],
          hasChapters: false,
          hasAttachments: false,
        },
        target: "hevc",
        backend: "cuda",
        ffmpeg: "ffmpeg",
        ffprobe: "ffprobe",
        mkvmerge: "mkvmerge",
        conservative: false,
      }),
    ).toThrow(/duration/i);
  });
});

describe("ISO remux and custom audio arguments", () => {
  it("copies video for ISO remux and does not pick an encoder", () => {
    const plan = planFromSuggestion(suggestion);
    const args = isoRemuxArgs("/mnt/nas/discs/Example.iso", "/tmp/out.mkv", plan);
    expect(args).toContain("/mnt/nas/discs/Example.iso");
    expect(args).toContain("-c");
    expect(args).toContain("copy");
    expect(args.join(" ")).not.toMatch(/nvenc|vaapi/);
  });

  it("uses the bluray protocol for BR-DISK images", () => {
    const path =
      "/mnt/nas/Movies/The Hunger Games (2012)/The Hunger Games (2012) {imdb-tt1392170}[BR-DISK][bit][]-F13.iso";
    const args = isoDemuxArgs(path);
    expect(args).toEqual(["-i", `bluray:${path}`]);
    expect(args.join(" ")).not.toContain("-f bluray");
  });

  it("tries bluray protocol then playlists before a raw ISO file", () => {
    const path =
      "/mnt/nas/Movies/The Hunger Games (2012)/The Hunger Games (2012) {imdb-tt1392170}[BR-DISK][bit][]-F13.iso";
    const attempts = isoInputAttempts(path);
    expect(attempts[0]).toEqual(["-i", `bluray:${path}`]);
    expect(attempts.some((args) => args.includes("-playlist") && args.includes("0"))).toBe(true);
    expect(attempts.some((args) => args.includes("-playlist") && args.includes("1"))).toBe(true);
    expect(attempts.at(-1)).toEqual(["-i", path]);
  });

  it("remuxes an ISO to Matroska before a video encode", () => {
    const plan = planFromSuggestion({ ...suggestion, actions: ["transcode"] });
    expect(optimizeSteps("/mnt/nas/Movies/Cars 3.iso", plan)).toEqual(["iso_remux", "encode"]);
    expect(optimizeSteps("/mnt/nas/Movies/Cars 3.mkv", plan)).toEqual(["encode"]);
  });

  it("builds AAC from a selected source stream", () => {
    const args = audioAacArgs("/in.mkv", "/out.aac", 1, 6, "160k");
    expect(args).toContain("0:1");
    expect(args).toContain("6");
    expect(args).toContain("aac");
  });
});
