import { isMediaFilePath } from "./inspect.ts";

export type ArrMovie = {
  id: number;
  title: string;
  path: string;
  size: number;
  quality: string;
  resolution: string;
  profile: string;
  tags: string[];
  posterUrl: string | null;
};

export type ArrEpisode = ArrMovie & {
  seriesId: number;
  episodeFileId: number | null;
  seriesTitle: string;
  season: number;
  episode: number;
  episodeTitle: string;
};

export type ConnectionResult =
  | { ok: true }
  | { ok: false; kind: "auth" | "connect" | "shape"; message: string };

export async function fetchJson(url: string, apiKey: string, httpFetch: typeof fetch): Promise<unknown> {
  const res = await httpFetch(url, { headers: { "X-Api-Key": apiKey } });
  if (res.status === 401 || res.status === 403) {
    const err = new Error("The Arr rejected this API key.") as Error & { kind: "auth" };
    err.kind = "auth";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`The Arr returned HTTP ${res.status}.`) as Error & { kind: "connect" };
    err.kind = "connect";
    throw err;
  }
  return res.json();
}

export function parseRadarrMovies(payload: unknown): ArrMovie[] {
  if (!Array.isArray(payload)) throw shape("Radarr movie list");
  return payload.flatMap((raw) => {
    const row = asRecord(raw);
    const file = movieFileOf(row);
    const path = str(file?.path, "");
    if (!path || !isMediaFilePath(path)) return [];
    const quality = qualityName(file ?? {});
    return [{
      id: num(row.id),
      title: str(row.title, "Untitled"),
      path,
      size: num(file?.size ?? row.sizeOnDisk),
      quality,
      resolution: resolutionFrom(quality, file ?? {}),
      profile: str(asRecord(row.qualityProfile).name, ""),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      posterUrl: posterFrom(row.images),
    }];
  });
}

export function parseSonarrSeries(payload: unknown): Array<{ id: number; title: string; posterUrl: string | null; profile: string; tags: string[] }> {
  if (!Array.isArray(payload)) throw shape("Sonarr series list");
  return payload.map((raw) => {
    const row = asRecord(raw);
    return {
      id: num(row.id),
      title: str(row.title, "Untitled"),
      posterUrl: posterFrom(row.images),
      profile: str(asRecord(row.qualityProfile).name, ""),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    };
  });
}

export function parseSonarrEpisodes(payload: unknown, seriesTitle: string, posterUrl: string | null, profile: string, tags: string[]): ArrEpisode[] {
  if (!Array.isArray(payload)) throw shape("Sonarr episode list");
  return payload
    .map((raw) => {
      const row = asRecord(raw);
      const file = asRecord(row.episodeFile);
      if (!file.path || !isMediaFilePath(str(file.path, ""))) return null;
      const quality = qualityName(file);
      return {
        id: num(row.id),
        seriesId: num(row.seriesId),
        episodeFileId: file.id == null ? null : num(file.id),
        title: seriesTitle,
        seriesTitle,
        season: num(row.seasonNumber),
        episode: num(row.episodeNumber),
        episodeTitle: str(row.title, "Episode"),
        path: str(file.path, ""),
        size: num(file.size),
        quality,
        resolution: resolutionFrom(quality, file),
        profile,
        tags,
        posterUrl,
      };
    })
    .filter((row): row is ArrEpisode => Boolean(row));
}

export function parseRootFolders(payload: unknown): string[] {
  if (!Array.isArray(payload)) throw shape("Arr root-folder list");
  return payload
    .map((raw) => str(asRecord(raw).path, "").trim())
    .filter((path) => path.length > 0);
}

export async function testRadarr(url: string, apiKey: string, httpFetch: typeof fetch): Promise<ConnectionResult> {
  try {
    const payload = await fetchJson(`${trimUrl(url)}/api/v3/system/status`, apiKey, httpFetch);
    const row = asRecord(payload);
    if (typeof row.appName === "string" || typeof row.version === "string") return { ok: true };
    return { ok: false, kind: "shape", message: "That URL answered, but it does not look like Radarr." };
  } catch (error) {
    return connectionError(error);
  }
}

export async function testSonarr(url: string, apiKey: string, httpFetch: typeof fetch): Promise<ConnectionResult> {
  try {
    const payload = await fetchJson(`${trimUrl(url)}/api/v3/system/status`, apiKey, httpFetch);
    const row = asRecord(payload);
    if (typeof row.appName === "string" && String(row.appName).toLowerCase().includes("sonarr")) return { ok: true };
    if (typeof row.version === "string") return { ok: true };
    return { ok: false, kind: "shape", message: "That URL answered, but it does not look like Sonarr." };
  } catch (error) {
    return connectionError(error);
  }
}

export function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function connectionError(error: unknown): ConnectionResult {
  const err = error as { kind?: string; message?: string };
  if (err.kind === "auth") return { ok: false, kind: "auth", message: "The Arr rejected this API key." };
  if (err.kind === "shape") return { ok: false, kind: "shape", message: err.message ?? "Unexpected response." };
  return { ok: false, kind: "connect", message: "Polisharr could not reach that URL." };
}

function shape(what: string): Error {
  const err = new Error(`The ${what} was not the expected JSON.`) as Error & { kind: "shape" };
  err.kind = "shape";
  return err;
}

function movieFileOf(row: Record<string, unknown>): Record<string, unknown> | null {
  if (row.movieFile && typeof row.movieFile === "object") return asRecord(row.movieFile);
  return null;
}

function qualityName(file: Record<string, unknown>): string {
  const q = asRecord(asRecord(file.quality).quality);
  return str(q.name ?? q.resolution, "");
}

function resolutionFrom(quality: string, file: Record<string, unknown>): string {
  const media = asRecord(file.mediaInfo);
  return str(media.resolution, quality);
}

function posterFrom(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const poster = images.map(asRecord).find((img) => String(img.coverType) === "poster");
  const url = poster ? str(poster.url ?? poster.remoteUrl, "") : "";
  return url || null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
