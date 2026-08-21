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

export type ProfileRecord = {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  items: unknown;
  raw: Record<string, unknown>;
};

export function parseProfiles(payload: unknown): ProfileRecord[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    if (typeof rec.id !== "number" || typeof rec.name !== "string") return [];
    return [
      {
        id: rec.id,
        name: rec.name,
        upgradeAllowed: rec.upgradeAllowed === true,
        items: rec.items,
        raw: rec,
      },
    ];
  });
}

export function profileAllowsQuality(items: unknown, qualityName: string): boolean {
  if (!qualityName || !Array.isArray(items)) return false;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    if (profileAllowsQuality(rec.items, qualityName)) return true;
    const quality = rec.quality && typeof rec.quality === "object" ? (rec.quality as Record<string, unknown>) : null;
    if (rec.allowed && quality && String(quality.name) === qualityName) return true;
  }
  return false;
}

export function pickPreventUpgradeProfile(
  profiles: ProfileRecord[],
  wantedName: string,
  currentQuality: string,
): ProfileRecord | undefined {
  const named = profiles.find((p) => p.name === wantedName);
  if (named) return named;
  return profiles.find((p) => !p.upgradeAllowed && profileAllowsQuality(p.items, currentQuality));
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
    if (found) {
      result.unchanged.push(preview.name);
      continue;
    }
    try {
      const created = await createNamedProfile(base, headers, existing, preview.name, opts.fetch);
      if (created) result.created.push(preview.name);
      else result.failed.push(preview.name);
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
  currentQuality?: string;
  fetch: typeof fetch;
}): Promise<string | null> {
  const base = opts.url.replace(/\/+$/, "");
  const headers = { "X-Api-Key": opts.apiKey, "Content-Type": "application/json" };
  const listed = await opts.fetch(`${base}/api/v3/qualityprofile`, { headers });
  if (!listed.ok) return "Could not list quality profiles.";
  const profiles = parseProfiles(await listed.json());
  let currentQuality = opts.currentQuality ?? "";
  let resource: Record<string, unknown> | null = null;
  let resourceUrl = "";
  if (opts.kind === "radarr" && opts.movieId != null) {
    resourceUrl = `${base}/api/v3/movie/${opts.movieId}`;
    resource = await getRecord(resourceUrl, headers, opts.fetch);
    currentQuality = movieQualityName(resource) || currentQuality;
  } else if (opts.kind === "sonarr" && opts.seriesId != null) {
    resourceUrl = `${base}/api/v3/series/${opts.seriesId}`;
    resource = await getRecord(resourceUrl, headers, opts.fetch);
  }
  if (!resource || !resourceUrl) return "That title has no Arr id for profile assignment.";

  let profile = pickPreventUpgradeProfile(profiles, opts.profileName, currentQuality);
  if (!profile) {
    const created = await createNamedProfile(base, headers, profiles, opts.profileName, opts.fetch, currentQuality);
    if (!created) return `Could not create the ${opts.profileName} profile.`;
    profile = created;
  }

  resource.qualityProfileId = profile.id;
  const res = await opts.fetch(resourceUrl, { method: "PUT", headers, body: JSON.stringify(resource) });
  if (!res.ok) return `${opts.kind === "radarr" ? "Radarr" : "Sonarr"} rejected the profile assign (HTTP ${res.status}).`;
  if (opts.kind === "sonarr") return "This Sonarr profile applies to the whole series, including future episodes.";
  return null;
}

async function getRecord(url: string, headers: Record<string, string>, httpFetch: typeof fetch): Promise<Record<string, unknown> | null> {
  const res = await httpFetch(url, { headers });
  if (!res.ok) return null;
  const payload: unknown = await res.json();
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

function movieQualityName(movie: Record<string, unknown> | null): string {
  if (!movie) return "";
  const file = movie.movieFile && typeof movie.movieFile === "object" ? (movie.movieFile as Record<string, unknown>) : null;
  const wrap = file?.quality && typeof file.quality === "object" ? (file.quality as Record<string, unknown>) : null;
  const quality = wrap?.quality && typeof wrap.quality === "object" ? (wrap.quality as Record<string, unknown>) : null;
  return typeof quality?.name === "string" ? quality.name : "";
}

async function createNamedProfile(
  base: string,
  headers: Record<string, string>,
  existing: ProfileRecord[],
  name: string,
  httpFetch: typeof fetch,
  currentQuality = "",
): Promise<ProfileRecord | null> {
  const schemaRes = await httpFetch(`${base}/api/v3/qualityprofile/schema`, { headers });
  const schema = schemaRes.ok ? ((await schemaRes.json()) as Record<string, unknown>) : {};
  const donor =
    existing.find((p) => profileAllowsQuality(p.items, currentQuality)) ?? existing[0];
  const body: Record<string, unknown> = {
    ...(schema && typeof schema === "object" ? schema : {}),
    ...(donor?.raw ?? {}),
    name,
    upgradeAllowed: false,
  };
  delete body.id;
  const res = await httpFetch(`${base}/api/v3/qualityprofile`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const created: unknown = await res.json();
  const parsed = parseProfiles([created]);
  return parsed[0] ?? null;
}
