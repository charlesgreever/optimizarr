import { describe, expect, it } from "vitest";
import { isIsoPath, parseFfprobe, pickPlayableVideo, trackEditingAvailable, unlistedIsoReport } from "./inspect.ts";
import { isoFailedFfmpeg, isoListedFfmpeg, mkv4kHdrFfprobe, mkvNormalFfprobe } from "./fixtures/index.ts";

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

  it("loads the normal MKV fixture into a public inspection report", () => {
    const report = parseFfprobe("/mnt/nas/Example.mkv", 18_500_000_000, mkvNormalFfprobe);
    expect(report.videoCodec).toBe("hevc");
    expect(report.width).toBe(1920);
    expect(report.height).toBe(1080);
    expect(report.bitDepth).toBe(10);
    expect(report.audio).toHaveLength(4);
    expect(report.subtitles).toHaveLength(3);
    expect(report.hasChapters).toBe(true);
    expect(report.hasAttachments).toBe(true);
  });

  it("loads the 4K HDR fixture without using cover art for size", () => {
    const report = parseFfprobe("/mnt/nas/Avatar.mkv", 28_000_000_000, mkv4kHdrFfprobe);
    expect(report.width).toBe(3840);
    expect(report.height).toBe(2160);
    expect(report.bitDepth).toBe(10);
    expect(report.hdr).toBe("dolby_vision");
    expect(report.audio[0]?.channels).toBe(8);
  });

  it("keeps recorded ISO listings for later ffmpeg parsing", () => {
    expect(isoListedFfmpeg).toMatch(/Stream #0:0.*Video: mpeg2video/i);
    expect(isoListedFfmpeg).toMatch(/Audio: ac3/);
    expect(isoListedFfmpeg).toMatch(/Subtitle: hdmv_pgs_subtitle/);
    expect(isoFailedFfmpeg).toMatch(/Invalid data found when processing input/);
    expect(isoFailedFfmpeg).not.toMatch(/Stream #0:/);
  });

  it("classifies ISO paths without treating them as ffprobe failures", () => {
    expect(isIsoPath("/mnt/nas/disc.iso")).toBe(true);
    expect(isIsoPath("/mnt/nas/DISC.ISO")).toBe(true);
    expect(isIsoPath("/mnt/nas/movie.mkv")).toBe(false);
    const failed = unlistedIsoReport("/mnt/nas/Broken.iso", 8_000_000_000);
    expect(failed.sourceMethod).toBe("iso_ffmpeg");
    expect(failed.listingState).toBe("iso_unlisted");
    expect(trackEditingAvailable(failed)).toBe(false);
    const mkv = parseFfprobe("/mnt/nas/Example.mkv", 18_500_000_000, mkvNormalFfprobe);
    expect(mkv.sourceMethod).toBe("ffprobe");
    expect(mkv.listingState).toBe("complete");
    expect(trackEditingAvailable(mkv)).toBe(true);
  });
});
