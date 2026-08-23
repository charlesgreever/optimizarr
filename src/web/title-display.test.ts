import { describe, expect, it } from "vitest";
import { channelLabel, fileNameFromPath, formatDuration, hdrLabel, usefulTrackTitle } from "./title-display.ts";

describe("title page facts", () => {
  it("splits the file name from a library path", () => {
    expect(fileNameFromPath("/mnt/nas/movies/1917 (2019)/1917.2019.2160p.mkv")).toBe("1917.2019.2160p.mkv");
    expect(fileNameFromPath("D:\\Media\\1917.mkv")).toBe("1917.mkv");
    expect(fileNameFromPath("")).toBe("");
  });

  it("hides release-name track titles and keeps real names", () => {
    expect(usefulTrackTitle(
      "1917.2019.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.TrueHD.7.1.Atmos-SWTYBLZ",
      "1917.2019.2160p.mkv",
    )).toBeNull();
    expect(usefulTrackTitle("English-SRT", "1917.2019.2160p.mkv")).toBe("English-SRT");
    expect(usefulTrackTitle("Director Commentary", "film.mkv")).toBe("Director Commentary");
  });

  it("labels channels, HDR, and duration for the header", () => {
    expect(channelLabel(8)).toBe("7.1");
    expect(channelLabel(6)).toBe("5.1");
    expect(channelLabel(2)).toBe("stereo");
    expect(hdrLabel("dolby_vision")).toBe("Dolby Vision");
    expect(hdrLabel("none")).toBe("SDR");
    expect(formatDuration(7140)).toBe("1h 59m");
    expect(formatDuration(0)).toBeNull();
  });
});
