import { describe, expect, it } from "vitest";
import { displayTitle, matchesTitleSearch } from "./titles.ts";
import type { LibraryItem } from "./types.ts";

const episode: LibraryItem = {
  id: "e1",
  instanceId: "sonarr",
  instanceName: "TV",
  arrId: 2,
  type: "episode",
  title: "Ted Lasso",
  showTitle: "Ted Lasso",
  season: 3,
  episode: 2,
  episodeTitle: "Chelsea",
  path: "/tv/ted.mkv",
  sizeBytes: 1,
  quality: "HDTV-1080p",
  resolution: "1080",
  profile: "HD",
  tags: [],
  posterRemoteUrl: null,
  hasPoster: false,
  sizeExempt: false,
};

describe("titles", () => {
  it("labels episodes as show, season, then episode title", () => {
    expect(displayTitle(episode)).toContain("Ted Lasso S03E02");
    expect(displayTitle(episode)).toContain("Chelsea");
  });

  it("matches multi-token and SxxExx queries", () => {
    expect(matchesTitleSearch("ted lasso chelsea", episode)).toBe(true);
    expect(matchesTitleSearch("rebels s03e02", episode)).toBe(false);
    expect(matchesTitleSearch("s03e02", episode)).toBe(true);
    expect(matchesTitleSearch("3x02", episode)).toBe(true);
  });
});
