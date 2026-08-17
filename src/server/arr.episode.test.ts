import { describe, expect, it } from "vitest";
import { ArrClient, parseEpisode, posterUrlFromImages, resolveArrAssetUrl } from "./arr.ts";

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

  it("picks a poster from Arr images and inherits the series poster on episodes", async () => {
    expect(
      posterUrlFromImages([
        { coverType: "fanart", url: "/MediaCover/3/fanart.jpg" },
        { coverType: "poster", url: "/MediaCover/3/poster.jpg" },
      ]),
    ).toBe("/MediaCover/3/poster.jpg");
    expect(resolveArrAssetUrl("http://sonarr:8989/", "/MediaCover/3/poster.jpg")).toBe(
      "http://sonarr:8989/MediaCover/3/poster.jpg",
    );

    const client = new ArrClient(async (url) => {
      if (url.includes("/series") && !url.includes("episode")) {
        return Response.json([
          {
            id: 3,
            title: "Andor",
            images: [{ coverType: "poster", url: "/MediaCover/3/poster.jpg" }],
          },
        ]);
      }
      if (url.includes("/episode")) {
        return Response.json([
          {
            id: 11,
            title: "Kassa",
            seasonNumber: 1,
            episodeNumber: 1,
            hasFile: true,
            episodeFile: { path: "/tv/andor.mkv", size: 1 },
          },
        ]);
      }
      return new Response("no", { status: 404 });
    });
    const items = await client.listEpisodes({
      id: 1,
      kind: "sonarr",
      name: "Sonarr",
      url: "http://sonarr:8989",
      apiKey: "k",
      enabled: true,
    });
    expect(items[0].posterRemoteUrl).toBe("http://sonarr:8989/MediaCover/3/poster.jpg");
  });
});
