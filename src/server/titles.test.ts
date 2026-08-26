import { describe, expect, it } from "vitest";
import { displayTitle, displayTitleForFile, matchesTitleSearch, seriesGroupKey, sharedFileLabel } from "./titles.ts";
import type { LibraryItem } from "./types.ts";

const episode: LibraryItem = {
  id: "e1",
  instanceId: "sonarr",
  instanceName: "TV",
  arrId: 2,
  arrSeriesId: 9,
  arrEpisodeFileId: 77,
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

  it("combines sibling episodes that share a file", () => {
    const e35 = { ...episode, id: "e35", showTitle: "Paw Patrol", season: 8, episode: 35, episodeTitle: "Rescue Knights: Pups Save the Baby Dragons", title: "Paw Patrol" };
    const e36 = { ...episode, id: "e36", showTitle: "Paw Patrol", season: 8, episode: 36, episodeTitle: "Rescue Knights: Pups Break the Ice", title: "Paw Patrol" };
    expect(displayTitleForFile([e36, e35])).toBe("Paw Patrol S08E35–E36 · Rescue Knights: Pups Save the Baby Dragons");
    expect(sharedFileLabel(e35, [e35, e36])).toBe("Same file as E36");
    expect(sharedFileLabel(e36, [e35, e36])).toBe("Same file as E35");
  });

  it("joins non-contiguous episode numbers with an ampersand", () => {
    const e35 = { ...episode, id: "e35", episode: 35, episodeTitle: "Dragons" };
    const e37 = { ...episode, id: "e37", episode: 37, episodeTitle: "Ice" };
    expect(displayTitleForFile([e35, e37])).toBe("Ted Lasso S03E35&E37 · Dragons");
  });

  it("groups episodes by show, not by episode title", () => {
    const a = { ...episode, id: "e1", episodeTitle: "Chelsea" };
    const b = { ...episode, id: "e2", episode: 3, episodeTitle: "Sunflowers" };
    expect(seriesGroupKey(a)).toBe(seriesGroupKey(b));
    expect(seriesGroupKey(a)).toBe("sonarr::series:9");
    const untitled = { ...episode, arrSeriesId: null, showTitle: "Ted Lasso" };
    expect(seriesGroupKey(untitled)).toContain("Ted Lasso");
    expect(seriesGroupKey(untitled)).not.toContain("Chelsea");
  });
});
