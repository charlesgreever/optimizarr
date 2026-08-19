import { describe, expect, it } from "vitest";
import { parseSonarrEpisodes } from "./arr.ts";

describe("Arr identity", () => {
  it("keeps Sonarr series id and episode file id separate from the episode id", () => {
    const episodes = parseSonarrEpisodes(
      [
        {
          id: 44,
          seriesId: 9,
          seasonNumber: 3,
          episodeNumber: 2,
          title: "The One",
          hasFile: true,
          episodeFile: { id: 77, path: "/mnt/nas/tv/show.s03e02.mkv", size: 1_000_000_000, quality: { quality: { name: "Bluray-1080p" } } },
        },
      ],
      "Ted Lasso",
      null,
      "HD",
      [],
    );
    expect(episodes[0]?.id).toBe(44);
    expect(episodes[0]?.seriesId).toBe(9);
    expect(episodes[0]?.episodeFileId).toBe(77);
  });
});
