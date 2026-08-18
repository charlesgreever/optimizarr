import { describe, expect, it } from "vitest";
import { parseFfprobe, sizeCategory, sizePerHourGb } from "./inspect.ts";

const hevc1080 = {
  format: { duration: "3600", size: String(1.5 * 1024 ** 3) },
  streams: [
    { codec_type: "video", codec_name: "hevc", width: 1920, height: 1080, bits_per_raw_sample: "10", pix_fmt: "yuv420p10le" },
    { codec_type: "audio", codec_name: "truehd", channels: 8, tags: { language: "eng" } },
    { codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle", tags: { language: "eng" } },
  ],
};

const dv4k = {
  format: { duration: "7200", size: String(40 * 1024 ** 3) },
  streams: [
    {
      codec_type: "video",
      codec_name: "hevc",
      width: 3840,
      height: 2160,
      bits_per_raw_sample: "10",
      side_data_list: [{ side_data_type: "DOVI configuration record" }],
    },
    { codec_type: "audio", codec_name: "eac3", channels: 6, tags: { language: "eng" } },
  ],
};

describe("inspector fixtures", () => {
  it("reads codec, bit depth, languages, and size/hour from ffprobe JSON", () => {
    const report = parseFfprobe("/media/a.mkv", hevc1080);
    expect(report.videoCodec).toBe("hevc");
    expect(report.bitDepth).toBe(10);
    expect(report.audio[0].language).toBe("eng");
    expect(report.subtitles[0].language).toBe("eng");
    expect(sizePerHourGb(report)).toBeCloseTo(1.5, 2);
    expect(sizeCategory("movie", report)).toBe("movie1080p");
  });

  it("detects 4K HDR / Dolby Vision", () => {
    const report = parseFfprobe("/media/b.mkv", dv4k);
    expect(report.hdr).toBe("dolby_vision");
    expect(sizeCategory("movie", report)).toBe("movie4kHdr");
    expect(sizeCategory("episode", report)).toBe("tv4k");
  });

  it("ignores a cover image and reads the 4K video stream", () => {
    const report = parseFfprobe("/media/cover.mkv", {
      format: { duration: "3600", size: String(16 * 1024 ** 3) },
      streams: [
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 600,
          height: 900,
          disposition: { attached_pic: 1 },
        },
        {
          codec_type: "video",
          codec_name: "hevc",
          width: 3840,
          height: 1608,
          bits_per_raw_sample: "10",
          side_data_list: [{ side_data_type: "DOVI configuration record" }],
        },
      ],
    });
    expect(report.videoCodec).toBe("hevc");
    expect(report.width).toBe(3840);
    expect(report.height).toBe(1608);
    expect(report.hdr).toBe("dolby_vision");
    expect(sizeCategory("movie", report)).toBe("movie4kHdr");
  });

  it("uses coded width when ffprobe omits display size", () => {
    const report = parseFfprobe("/media/coded.mkv", {
      format: { duration: "3600", size: "1" },
      streams: [{ codec_type: "video", codec_name: "hevc", coded_width: 3840, coded_height: 2160 }],
    });
    expect(report.width).toBe(3840);
    expect(report.height).toBe(2160);
    expect(sizeCategory("movie", report)).toBe("movie4kSdr");
  });

  it("uses the Arr 2160p label when the probe has no dimensions", () => {
    const blank = parseFfprobe("/media/blank.mkv", {
      format: { duration: "3600", size: "1" },
      streams: [{ codec_type: "video", codec_name: "hevc" }],
    });
    expect(blank.width).toBe(0);
    expect(sizeCategory("movie", blank)).toBe("movie1080p");
    expect(sizeCategory("movie", blank, { quality: "WEBDL-2160p", resolution: "2160", hdr: "dolby_vision" })).toBe(
      "movie4kHdr",
    );
    expect(sizeCategory("movie", blank, { quality: "WEBDL-1080p", resolution: "1080" })).toBe("movie1080p");
  });
});
