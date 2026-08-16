import { describe, expect, it } from "vitest";
import { notifyArrRename, testPlayer } from "./notify.ts";

describe("player test", () => {
  it("reports a live Plex identity", async () => {
    const result = await testPlayer(async (url) => {
      expect(url).toContain("/identity");
      expect(url).toContain("X-Plex-Token=pt");
      return new Response('<MediaContainer version="1.41.2.9200">', { status: 200 });
    }, { id: 1, kind: "plex", name: "Plex", url: "http://plex:32400", token: "pt", enabled: true });
    expect(result).toEqual({ ok: true, version: "1.41.2.9200" });
  });

  it("rejects a bad Plex token", async () => {
    const result = await testPlayer(async () => new Response("nope", { status: 401 }), {
      id: 1,
      kind: "plex",
      name: "Plex",
      url: "http://plex:32400",
      token: "bad",
      enabled: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/token/i);
  });
});

describe("arr rename", () => {
  it("rescans the Sonarr series id, not the episode id", async () => {
    let body: unknown;
    await notifyArrRename(
      async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response("{}", { status: 201 });
      },
      { id: 1, kind: "sonarr", name: "Sonarr", url: "http://sonarr", apiKey: "k", enabled: true },
      {
        id: 9,
        instanceId: 1,
        instanceName: "Sonarr",
        instanceKind: "sonarr",
        externalId: 11,
        seriesId: 3,
        type: "episode",
        title: "Pilot",
        seriesTitle: "Show",
        seasonNumber: 1,
        episodeNumber: 1,
        path: "/tv/show.mkv",
        folderPath: "/tv",
        quality: null,
        videoCodec: null,
        resolution: null,
        hdr: null,
        size: 1,
        readable: true,
        pathError: null,
        updatedAt: "",
      },
    );
    expect(body).toEqual({ name: "RescanSeries", seriesId: 3 });
  });
});
