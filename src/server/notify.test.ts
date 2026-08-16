import { describe, expect, it } from "vitest";
import { testPlayer } from "./notify.ts";

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
