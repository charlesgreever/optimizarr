import { describe, expect, it } from "vitest";
import { assignProfile, parseProfiles, profilePreviews, syncProfiles } from "./arr-profiles.ts";

describe("Arr profile previews", () => {
  it("derives MB/min from current GB/hour caps without remote writes", () => {
    const previews = profilePreviews({ movie1080p: 2.5, movie4kSdr: 6, movie4kHdr: 8, tv1080p: 1, tv4k: 4 });
    expect(previews[0]?.name).toMatch(/^Optimizarr /);
    expect(previews.find((p) => p.category === "movie1080p")?.mbPerMin).toBe(42.7);
  });
});

describe("Arr profile HTTP", () => {
  it("creates missing Optimizarr profiles and never searches", async () => {
    const calls: string[] = [];
    const result = await syncProfiles({
      instanceId: "radarr",
      url: "http://radarr:7878",
      apiKey: "k",
      caps: { movie1080p: 2.5, movie4kSdr: 6, movie4kHdr: 8, tv1080p: 1, tv4k: 4 },
      fetch: (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (String(url).endsWith("/qualityprofile") && !init?.method) {
          return new Response(JSON.stringify([{ id: 1, name: "HD-1080p" }]));
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(result.created).toHaveLength(5);
    expect(calls.some((c) => /command|search/i.test(c))).toBe(false);
    expect(parseProfiles([{ id: 3, name: "Optimizarr Movie 1080p" }])[0]?.id).toBe(3);
  });

  it("assigns a movie profile without starting a search", async () => {
    const calls: string[] = [];
    const warning = await assignProfile({
      kind: "radarr",
      url: "http://radarr",
      apiKey: "k",
      movieId: 10,
      profileName: "Optimizarr Movie 1080p",
      fetch: (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (String(url).endsWith("/qualityprofile")) {
          return new Response(JSON.stringify([{ id: 9, name: "Optimizarr Movie 1080p" }]));
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(warning).toBeNull();
    expect(calls.some((c) => /search|command/i.test(c))).toBe(false);
    expect(calls.some((c) => c.includes("PUT") && c.includes("/movie/10"))).toBe(true);
  });
});
