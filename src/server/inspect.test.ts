import { describe, expect, it } from "vitest";
import { parseFfprobe, pickPlayableVideo } from "./inspect.ts";

describe("parseFfprobe", () => {
  it("ignores cover art when choosing 4K size", () => {
    const report = parseFfprobe("/media/Avatar.mkv", 16_000_000_000, {
      format: { duration: "5900" },
      streams: [
        { codec_type: "video", codec_name: "mjpeg", width: 600, height: 900, disposition: { attached_pic: 1 } },
        { codec_type: "video", codec_name: "hevc", coded_width: 3840, coded_height: 2160, pix_fmt: "yuv420p10le", tags: { HDR: "Dolby Vision" } },
        { codec_type: "audio", codec_name: "eac3", channels: 8, tags: { language: "eng" }, index: 2 },
      ],
    });
    expect(report.width).toBe(3840);
    expect(report.height).toBe(2160);
    expect(report.bitDepth).toBe(10);
    expect(report.hdr).toBe("dolby_vision");
    expect(report.sizePerHourGb).toBeGreaterThan(8);
  });

  it("uses coded size when display size is missing", () => {
    const video = pickPlayableVideo([
      { codec_type: "video", codec_name: "h264", coded_width: 1920, coded_height: 1080 },
    ]);
    expect(video?.coded_width).toBe(1920);
  });
});
