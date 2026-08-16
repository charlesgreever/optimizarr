import { describe, expect, it } from "vitest";
import { parseEpisode } from "./arr.ts";

describe("sonarr episode parse", () => {
  it("keeps series, season, and episode as separate fields", () => {
    const parsed = parseEpisode(
      {
        id: 44,
        title: "Pilot",
        seasonNumber: 1,
        episodeNumber: 2,
        hasFile: true,
        episodeFile: { path: "/mnt/nas/TV/Show/S01E02.mkv", size: 10 },
      },
      "Andor",
    );
    expect(parsed).toMatchObject({
      seriesTitle: "Andor",
      seasonNumber: 1,
      episodeNumber: 2,
      title: "Pilot",
      path: "/mnt/nas/TV/Show/S01E02.mkv",
    });
  });

  it("skips episodes with no file", () => {
    expect(parseEpisode({ id: 1, title: "TBA", seasonNumber: 2, episodeNumber: 1 }, "Show")).toBeNull();
  });
});
