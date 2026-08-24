import { describe, expect, it } from "vitest";
import { parseRadarrMovies, parseRootFolders, parseSonarrEpisodes } from "./arr.ts";

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

  it("skips an episode that has a file flag but no path", () => {
    const episodes = parseSonarrEpisodes(
      [{ id: 44, seriesId: 9, seasonNumber: 3, episodeNumber: 2, title: "The One", hasFile: true }],
      "Ted Lasso",
      null,
      "HD",
      [],
    );
    expect(episodes).toEqual([]);
  });

  it("skips a Radarr movie that has no media file yet", () => {
    const movies = parseRadarrMovies([
      { id: 1, title: "Moana", path: "/mnt/nas/Kids Movies/Moana (2026)", hasFile: false },
      {
        id: 2,
        title: "Cars 3",
        movieFile: { path: "/mnt/nas/Kids Movies/Cars 3.mkv", size: 2, quality: { quality: { name: "Bluray-1080p" } } },
      },
    ]);
    expect(movies.map((row) => row.title)).toEqual(["Cars 3"]);
    expect(movies[0]?.path).toBe("/mnt/nas/Kids Movies/Cars 3.mkv");
  });

  it("prefers the Arr-hosted poster path over an external remote URL", () => {
    const movies = parseRadarrMovies([{
      id: 1,
      title: "Film",
      movieFile: { path: "/movies/film.mkv", size: 1 },
      images: [{ coverType: "poster", url: "/MediaCover/1/poster.jpg", remoteUrl: "https://cdn.example/poster.jpg" }],
    }]);

    expect(movies[0]?.posterUrl).toBe("/MediaCover/1/poster.jpg");
  });

  it("parses authoritative Arr library roots", () => {
    expect(parseRootFolders([{ id: 1, path: "/mnt/nas/movies" }, { id: 2, path: "/mnt/nas/uhd" }])).toEqual([
      "/mnt/nas/movies",
      "/mnt/nas/uhd",
    ]);
  });
});
