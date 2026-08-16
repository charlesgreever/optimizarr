import { describe, expect, it } from "vitest";
import { ArrClient, parseEpisode } from "./arr.ts";

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

  it("loads episode paths from Sonarr when the list omits episodeFile", async () => {
    const urls: string[] = [];
    const client = new ArrClient(async (url) => {
      urls.push(url);
      if (url.includes("/series") && !url.includes("episode")) {
        return Response.json([{ id: 3, title: "Star Wars Rebels", path: "/mnt/nas/TV/Star Wars Rebels" }]);
      }
      if (url.includes("/episodefile")) {
        return Response.json([
          { id: 99, path: "/mnt/nas/TV/Star Wars Rebels/S01E01.mkv", size: 1234 },
        ]);
      }
      if (url.includes("/episode")) {
        const includeFile = url.includes("includeEpisodeFile=true");
        return Response.json([
          {
            id: 11,
            title: "Spark of Rebellion",
            seasonNumber: 1,
            episodeNumber: 1,
            hasFile: true,
            episodeFileId: 99,
            ...(includeFile
              ? { episodeFile: { path: "/mnt/nas/TV/Star Wars Rebels/S01E01.mkv", size: 1234 } }
              : {}),
          },
        ]);
      }
      return new Response("no", { status: 404 });
    });
    const items = await client.listEpisodes({
      id: 1,
      kind: "sonarr",
      name: "Sonarr",
      url: "http://sonarr",
      apiKey: "k",
      enabled: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("/mnt/nas/TV/Star Wars Rebels/S01E01.mkv");
    expect(items[0].seriesTitle).toBe("Star Wars Rebels");
    expect(items[0].seriesId).toBe(3);
    expect(urls.some((u) => u.includes("includeEpisodeFile=true") || u.includes("/episodefile"))).toBe(true);
  });
});
