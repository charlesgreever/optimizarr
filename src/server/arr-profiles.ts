import type { SizeCaps, SizeCategory } from "./types.ts";
import { DEFAULT_SIZE_CAPS } from "./types.ts";

export const PROFILE_NAMES: Record<SizeCategory, string> = {
  movie1080p: "Optimizarr Movie 1080p",
  movie4kSdr: "Optimizarr Movie 4K SDR",
  movie4kHdr: "Optimizarr Movie 4K HDR",
  tv1080p: "Optimizarr TV 1080p",
  tv4k: "Optimizarr TV 4K",
};

export type ProfilePreview = {
  category: SizeCategory;
  name: string;
  gbPerHour: number;
  mbPerMin: number;
};

export function profilePreviews(caps: SizeCaps = DEFAULT_SIZE_CAPS): ProfilePreview[] {
  return (Object.keys(PROFILE_NAMES) as SizeCategory[]).map((category) => {
    const gbPerHour = caps[category];
    return {
      category,
      name: PROFILE_NAMES[category],
      gbPerHour,
      mbPerMin: Math.round(((gbPerHour * 1024) / 60) * 10) / 10,
    };
  });
}

export type ProfileRecord = { id: number; name: string };

export function parseProfiles(payload: unknown): ProfileRecord[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== "number" || typeof rec.name !== "string") return [];
    return [{ id: rec.id, name: rec.name }];
  });
}

export type SyncResult = {
  instanceId: string;
  created: string[];
  updated: string[];
  unchanged: string[];
  failed: string[];
};

export async function syncProfiles(opts: {
  instanceId: string;
  url: string;
  apiKey: string;
  caps: SizeCaps;
  fetch: typeof fetch;
}): Promise<SyncResult> {
  const result: SyncResult = { instanceId: opts.instanceId, created: [], updated: [], unchanged: [], failed: [] };
  const base = opts.url.replace(/\/+$/, "");
  const headers = { "X-Api-Key": opts.apiKey, "Content-Type": "application/json" };
  const listed = await opts.fetch(`${base}/api/v3/qualityprofile`, { headers });
  if (!listed.ok) {
    result.failed.push("Could not list quality profiles.");
    return result;
  }
  const existing = parseProfiles(await listed.json());
  for (const preview of profilePreviews(opts.caps)) {
    const found = existing.find((p) => p.name === preview.name);
    try {
      if (!found) {
        const res = await opts.fetch(`${base}/api/v3/qualityprofile`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: preview.name, upgradeAllowed: false }),
        });
        if (res.ok) result.created.push(preview.name);
        else result.failed.push(preview.name);
      } else {
        const res = await opts.fetch(`${base}/api/v3/qualityprofile/${found.id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: found.id, name: preview.name }),
        });
        if (res.ok) result.updated.push(preview.name);
        else result.failed.push(preview.name);
      }
    } catch {
      result.failed.push(preview.name);
    }
  }
  return result;
}

export async function assignProfile(opts: {
  kind: "radarr" | "sonarr";
  url: string;
  apiKey: string;
  movieId?: number;
  seriesId?: number;
  profileName: string;
  fetch: typeof fetch;
}): Promise<string | null> {
  const base = opts.url.replace(/\/+$/, "");
  const headers = { "X-Api-Key": opts.apiKey, "Content-Type": "application/json" };
  const listed = await opts.fetch(`${base}/api/v3/qualityprofile`, { headers });
  if (!listed.ok) return "Could not list quality profiles.";
  const profile = parseProfiles(await listed.json()).find((p) => p.name === opts.profileName);
  if (!profile) return `The ${opts.profileName} profile is missing. Sync profiles in Settings first.`;
  if (opts.kind === "radarr" && opts.movieId != null) {
    const res = await opts.fetch(`${base}/api/v3/movie/${opts.movieId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ id: opts.movieId, qualityProfileId: profile.id }),
    });
    if (!res.ok) return `Radarr rejected the profile assign (HTTP ${res.status}).`;
    return null;
  }
  if (opts.kind === "sonarr" && opts.seriesId != null) {
    const res = await opts.fetch(`${base}/api/v3/series/${opts.seriesId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ id: opts.seriesId, qualityProfileId: profile.id }),
    });
    if (!res.ok) return `Sonarr rejected the profile assign (HTTP ${res.status}).`;
    return "This Sonarr profile applies to the whole series, including future episodes.";
  }
  return "That title has no Arr id for profile assignment.";
}
