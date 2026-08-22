import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  audioAacArgs,
  encodeArgs,
  ffmpegOptimizer,
  formatToolError,
  isoDemuxArgs,
  isoInputAttempts,
  isoRemuxArgs,
  isoRemuxIsShort,
  muxArgs,
  muxPlanArgs,
  nvencBitrate,
  optimizeSteps,
  parseFfmpegProgress,
  parseMkvmergeProgress,
  planFromSuggestion,
  scaleProgress,
  assertReviewCapacity,
} from "./optimize.ts";
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
    const args = muxArgs(
      source,
      "/mnt/nas/review-path/.work/out.mkv",
      { ...suggestion, keepAudio: [1], stripAudio: [2], keepSubs: [3], stripSubs: [4] },
      "/tmp/stereo.aac",
    );
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

  it("keeps a useful mkvmerge error written to standard output", () => {
    const output = {
      stderr: "",
      stdout: "Error: The source file type is unsupported.\n",
    };

    const message = formatToolError("mkvmerge", output);

    expect(message).toBe("mkvmerge failed. Error: The source file type is unsupported.");
  });

  it("keeps a valid remux when mkvmerge completes with warnings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "polisharr-mkvmerge-warning-"));
    try {
      const sourcePath = join(dir, "episode.mp4");
      const reviewDir = join(dir, "review");
      const mkvmerge = join(dir, "mkvmerge.cjs");
      const ffprobe = join(dir, "ffprobe.cjs");
      await writeFile(sourcePath, "source with captions");
      await writeFile(mkvmerge, [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "const args = process.argv.slice(2);",
        "const selected = args.includes('--subtitle-tracks') ? args[args.indexOf('--subtitle-tracks') + 1] : null;",
        "const keptCaptions = selected === null || selected.split(',').includes('2');",
        "fs.writeFileSync(args[args.indexOf('-o') + 1], keptCaptions ? 'captions' : 'no captions');",
        "process.stdout.write(keptCaptions",
        "  ? 'Warning: The MP4 timestamps required normalization.\\nProgress: 100%\\n'",
        "  : 'Warning: A subtitle track ID was requested but not found.\\nProgress: 100%\\n');",
        "process.exitCode = 1;",
      ].join("\n"));
      await writeFile(ffprobe, [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "const captions = fs.readFileSync(process.argv.at(-1), 'utf8') === 'captions';",
        "process.stdout.write(JSON.stringify({",
        "  format: { duration: '120' },",
        "  streams: [",
        "    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, bits_per_raw_sample: '8' },",
        "    ...(captions ? [{ index: 1, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } }] : [])",
        "  ]",
        "}));",
      ].join("\n"));
      await Promise.all([chmod(mkvmerge, 0o755), chmod(ffprobe, 0o755)]);

      const optimizer = ffmpegOptimizer({ capacity: async () => 10 * 1024 ** 3 });
      const remux = planFromSuggestion({
        ...suggestion,
        actions: ["remux"],
        keepAudio: [],
        stripAudio: [],
        keepSubs: [3],
        stripSubs: [],
      });
      const result = await optimizer({
        sourcePath,
        reviewDir,
        plan: remux,
        report: {
          sourceSig: "episode.mp4|13",
          sourceMethod: "ffprobe",
          listingState: "complete",
          durationSec: 120,
          sizeBytes: 13,
          sizePerHourGb: 0.001,
          videoCodec: "h264",
          width: 1920,
          height: 1080,
          bitDepth: 8,
          hdr: "none",
          audio: [],
          subtitles: [
            { index: 3, language: "eng", codec: "mov_text", title: "English", untagged: false, forced: false, sdh: false },
          ],
          hasChapters: false,
          hasAttachments: false,
        },
        target: "hevc",
        backend: "none",
        ffmpeg: "ffmpeg",
        ffprobe,
        mkvmerge,
        conservative: false,
      });

      expect(result.sidecarPath).toBe(join(reviewDir, "episode.mkv"));
      expect(result.output.durationSec).toBe(120);
      expect(result.output.subtitles).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes --no-subtitles when every subtitle is removed", () => {
    const plan = planFromSuggestion({ ...suggestion, keepSubs: [], stripSubs: [3, 4] });
    expect(muxPlanArgs(source, "/tmp/out.mkv", plan)).toContain("--no-subtitles");
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

describe("review capacity", () => {
  it("fails before work when the review volume cannot hold the planned output", async () => {
    await expect(assertReviewCapacity("/review", 2_000, async () => 1_000)).rejects.toThrow(/free space/i);
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
    expect(args).toContain("-progress");
    expect(args).toContain("pipe:1");
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

  it("rejects a 20 GB target when the remux is a 10-second title", () => {
    const req = {
      sourcePath: "/mnt/nas/Movies/The Hunger Games Catching Fire (2013)/Catching Fire.iso",
      reviewDir: "/tmp/review",
      plan: {
        origin: "custom" as const,
        video: { kind: "size" as const, codec: "hevc" as const, targetBytes: 20 * 1024 ** 3, downscale1080p: false, bitDepth: 8 },
        audio: [],
        subtitles: [],
        container: "mkv" as const,
        writeMode: "sidecar" as const,
        warning: null,
        reasons: ["Target 20 GB"],
        estimatedOutputBytes: 20 * 1024 ** 3,
        category: "movie1080p" as const,
      },
      report: {
        sourceSig: "p|1",
        sourceMethod: "iso_ffmpeg" as const,
        listingState: "complete" as const,
        durationSec: 10.01,
        sizeBytes: 40_000_000_000,
        sizePerHourGb: 0,
        videoCodec: "hevc",
        width: 3840,
        height: 2160,
        bitDepth: 10,
        hdr: "none" as const,
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
    expect(() => nvencBitrate(req, req.plan.video)).toThrow(
      /A 19\.9 GB target over 1 minutes needs 17099 Mbps, which the hardware encoder will reject/,
    );
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

describe("tool progress", () => {
  it("reads encode time from ffmpeg progress lines", () => {
    expect(parseFfmpegProgress("frame=12\nout_time_ms=90000000\nprogress=continue\n")).toBe(90);
    expect(parseFfmpegProgress("out_time_us=15000000\n")).toBe(15);
    expect(parseFfmpegProgress("out_time=00:02:05.50\n")).toBeCloseTo(125.5, 1);
    expect(parseFfmpegProgress("out_time_ms=N/A\n")).toBeNull();
  });

  it("reads mkvmerge percent lines", () => {
    expect(parseMkvmergeProgress("Progress: 45%\n")).toBe(0.45);
    expect(parseMkvmergeProgress("Progress: 100%\n")).toBe(1);
  });

  it("maps a phase ratio onto the overall job bar", () => {
    expect(scaleProgress(0.5, 0.9, 0)).toBe(0.5);
    expect(scaleProgress(0.5, 0.9, 1)).toBe(0.9);
    expect(scaleProgress(0.5, 0.9, 0.5)).toBeCloseTo(0.7, 5);
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

  it("remuxes the longest Blu-ray playlist and drops dummy 0-channel audio", () => {
    const plan = planFromSuggestion(suggestion);
    const args = isoRemuxArgs(
      "/mnt/nas/Catching Fire.iso",
      "/tmp/out.mkv",
      plan,
      {
        sourceSig: "p|1",
        sourceMethod: "iso_ffmpeg",
        listingState: "complete",
        durationSec: 8776,
        isoPlaylist: 0,
        sizeBytes: 40_000_000_000,
        sizePerHourGb: 16,
        videoCodec: "hevc",
        width: 3840,
        height: 2160,
        bitDepth: 10,
        hdr: "none",
        audio: [
          { index: 1, language: "eng", channels: 8, codec: "truehd", title: "", untagged: false, commentary: false },
          { index: 10, language: "und", channels: 0, codec: "ac3", title: "", untagged: true, commentary: false },
        ],
        subtitles: [],
        hasChapters: false,
        hasAttachments: false,
      },
    );
    expect(args).toContain("-playlist");
    expect(args[args.indexOf("-playlist") + 1]).toBe("0");
    expect(args).toContain("bluray:/mnt/nas/Catching Fire.iso");
    expect(args).toContain("-map");
    expect(args).toContain("0");
    expect(args).toContain("-0:10");
    expect(isoRemuxIsShort(8776, 10.01)).toBe(true);
    expect(isoRemuxIsShort(8776, 8700)).toBe(false);
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

  it("remuxes an opted-in MP4 before encoding and leaves MKV and disabled plans unchanged", () => {
    const remuxThenEncode = planFromSuggestion({
      ...suggestion,
      actions: ["transcode", "remux", "tracks", "add_stereo"],
      keepAudio: [1],
      stripAudio: [2],
    });
    const encodeOnly = planFromSuggestion({ ...suggestion, actions: ["transcode"] });
    const remuxOnly = planFromSuggestion({ ...suggestion, actions: ["remux"] });

    expect(optimizeSteps("/mnt/nas/Shows/Curious George S04E14.mp4", remuxThenEncode)).toEqual(["mux", "encode"]);
    expect(muxPlanArgs("/mnt/nas/Shows/Curious George S04E14.mp4", "/tmp/remuxed.mkv", remuxThenEncode)).toContain("--audio-tracks");
    expect(optimizeSteps("/mnt/nas/Shows/Curious George S04E14.mkv", encodeOnly)).toEqual(["encode"]);
    expect(optimizeSteps("/mnt/nas/Shows/Curious George S04E14.mp4", encodeOnly)).toEqual(["encode"]);
    expect(optimizeSteps("/mnt/nas/Shows/Curious George S04E14.mp4", remuxOnly)).toEqual(["mux"]);
  });

  it("builds AAC from a selected source stream", () => {
    const args = audioAacArgs("/in.mkv", "/out.aac", 1, 6, "160k");
    expect(args).toContain("0:1");
    expect(args).toContain("6");
    expect(args).toContain("aac");
  });
});
