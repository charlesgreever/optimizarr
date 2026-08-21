import { describe, expect, it } from "vitest";
import {
  assignProfile,
  parseProfiles,
  pickPreventUpgradeProfile,
  profileAllowsQuality,
  profilePreviews,
  syncProfiles,
} from "./arr-profiles.ts";

const caps = { movie1080p: 2.5, movie4kSdr: 6, movie4kHdr: 8, tv1080p: 1, tv4k: 4 };

const ultraHd = {
  id: 5,
  name: "Ultra-HD",
  upgradeAllowed: true,
  cutoff: 31,
  items: [
    { allowed: true, quality: { id: 18, name: "WEBDL-2160p" } },
    { allowed: true, quality: { id: 19, name: "Bluray-2160p" } },
    { allowed: true, quality: { id: 31, name: "Remux-2160p" } },
  ],
};

describe("Arr profile previews", () => {
  it("derives MB/min from current GB/hour caps without remote writes", () => {
    const previews = profilePreviews(caps);
    expect(previews[0]?.name).toMatch(/^Optimizarr /);
    expect(previews.find((p) => p.category === "movie1080p")?.mbPerMin).toBe(42.7);
  });

  it("prefers an existing no-upgrade profile that already allows the current quality", () => {
    const profiles = parseProfiles([
      { id: 1, name: "Any", upgradeAllowed: true, items: ultraHd.items },
      { id: 8, name: "No Upgrades 4K", upgradeAllowed: false, items: ultraHd.items },
    ]);
    const picked = pickPreventUpgradeProfile(profiles, "Optimizarr Movie 4K HDR", "Bluray-2160p");
    expect(picked?.id).toBe(8);
    expect(profileAllowsQuality(ultraHd.items, "Bluray-2160p")).toBe(true);
    expect(profileAllowsQuality(ultraHd.items, "SDTV")).toBe(false);
  });
});

describe("Arr profile HTTP", () => {
  it("creates missing Optimizarr profiles and never searches", async () => {
    const calls: string[] = [];
    const result = await syncProfiles({
      instanceId: "radarr",
      url: "http://radarr:7878",
      apiKey: "k",
      caps,
      fetch: (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (String(url).endsWith("/qualityprofile") && !init?.method) {
          return new Response(JSON.stringify([{ id: 1, name: "HD-1080p", upgradeAllowed: true, items: [] }]));
        }
        if (String(url).endsWith("/qualityprofile/schema")) {
          return new Response(JSON.stringify({ name: "", upgradeAllowed: false, items: [] }));
        }
        return new Response(JSON.stringify({ id: 20, name: "Optimizarr Movie 1080p", upgradeAllowed: false, items: [] }), { status: 200 });
      }) as typeof fetch,
    });
    expect(result.created).toHaveLength(5);
    expect(calls.some((c) => /command|search/i.test(c))).toBe(false);
    expect(parseProfiles([{ id: 3, name: "Optimizarr Movie 1080p" }])[0]?.id).toBe(3);
  });

  it("assigns a movie using an existing no-upgrade profile without creating one", async () => {
    const calls: string[] = [];
    const putBodies: Record<string, unknown>[] = [];
    const warning = await assignProfile({
      kind: "radarr",
      url: "http://radarr",
      apiKey: "k",
      movieId: 10,
      profileName: "Optimizarr Movie 4K HDR",
      currentQuality: "Bluray-2160p",
      fetch: (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (String(url).endsWith("/qualityprofile") && !init?.method) {
          return new Response(JSON.stringify([ultraHd, { ...ultraHd, id: 8, name: "No Upgrades 4K", upgradeAllowed: false }]));
        }
        if (String(url).includes("/movie/10") && init?.method === "PUT") {
          putBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return new Response("{}", { status: 202 });
        }
        if (String(url).includes("/movie/10")) {
          return new Response(JSON.stringify({ id: 10, title: "Film", qualityProfileId: 1, monitored: true, path: "/movies/film" }));
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(warning).toBeNull();
    expect(calls.some((c) => /search|command/i.test(c))).toBe(false);
    expect(calls.some((c) => c.includes("POST") && c.includes("/qualityprofile"))).toBe(false);
    expect(putBodies[0]?.qualityProfileId).toBe(8);
    expect(putBodies[0]?.title).toBe("Film");
    expect(putBodies[0]?.monitored).toBe(true);
  });

  it("creates the Optimizarr profile when no no-upgrade profile exists", async () => {
    const calls: string[] = [];
    const createdBodies: Record<string, unknown>[] = [];
    const warning = await assignProfile({
      kind: "radarr",
      url: "http://radarr",
      apiKey: "k",
      movieId: 10,
      profileName: "Optimizarr Movie 4K HDR",
      currentQuality: "Bluray-2160p",
      fetch: (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (String(url).endsWith("/qualityprofile/schema")) {
          return new Response(JSON.stringify({ name: "", upgradeAllowed: false, items: ultraHd.items }));
        }
        if (String(url).endsWith("/qualityprofile") && init?.method === "POST") {
          const createdBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          createdBodies.push(createdBody);
          return new Response(JSON.stringify({ id: 22, name: createdBody.name, upgradeAllowed: false, items: ultraHd.items }));
        }
        if (String(url).endsWith("/qualityprofile")) {
          return new Response(JSON.stringify([ultraHd]));
        }
        if (String(url).includes("/movie/10") && init?.method === "PUT") {
          return new Response("{}", { status: 202 });
        }
        if (String(url).includes("/movie/10")) {
          return new Response(
            JSON.stringify({
              id: 10,
              title: "Film",
              qualityProfileId: 5,
              movieFile: { quality: { quality: { name: "Bluray-2160p" } } },
            }),
          );
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(warning).toBeNull();
    expect(createdBodies[0]?.name).toBe("Optimizarr Movie 4K HDR");
    expect(createdBodies[0]?.upgradeAllowed).toBe(false);
    expect(createdBodies[0]).not.toHaveProperty("id");
    expect(calls.some((c) => /search|command/i.test(c))).toBe(false);
  });
});
