import type { ArrInstance } from "./models.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ArrMovie = {
  externalId: number;
  title: string;
  path: string;
  folderPath: string | null;
  quality: string | null;
  videoCodec: string | null;
  resolution: string | null;
  hdr: string | null;
  size: number | null;
};

export class ArrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArrError";
  }
}

export class ArrClient {
  constructor(private fetchImpl: FetchLike = fetch) {}

  async test(url: string, apiKey: string): Promise<{ version: string }> {
    const data = (await this.getJson(`${normalizeUrl(url)}/api/v3/system/status`, apiKey)) as Record<
      string,
      unknown
    >;
    const version = typeof data.version === "string" ? data.version : "unknown";
    return { version };
  }

  async listMovies(instance: ArrInstance): Promise<ArrMovie[]> {
    const rows = await this.getJsonArray(`${instance.url}/api/v3/movie`, instance.apiKey);
    return rows.map(parseMovie);
  }

  async listEpisodes(instance: ArrInstance): Promise<ArrMovie[]> {
    const series = await this.getJsonArray(`${instance.url}/api/v3/series`, instance.apiKey);
    const out: ArrMovie[] = [];
    for (const show of series) {
      const seriesId = Number(show.id);
      const title = String(show.title ?? "Series");
      const episodes = await this.getJsonArray(`${instance.url}/api/v3/episode?seriesId=${seriesId}`, instance.apiKey);
      for (const ep of episodes) {
        const parsed = parseEpisode(ep, title);
        if (parsed) out.push(parsed);
      }
    }
    return out;
  }

  private async getJson(url: string, apiKey: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { "X-Api-Key": apiKey } });
    } catch (err) {
      throw new ArrError(`Could not reach Arr at ${url}: ${err instanceof Error ? err.message : "network error"}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ArrError("Arr API key was rejected");
    }
    if (!res.ok) {
      throw new ArrError(`Arr returned HTTP ${res.status}`);
    }
    return res.json();
  }

  private async getJsonArray(url: string, apiKey: string): Promise<Record<string, unknown>[]> {
    const data = await this.getJson(url, apiKey);
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    throw new ArrError("Arr movie list was not an array");
  }
}

export function parseMovie(raw: Record<string, unknown>): ArrMovie {
  const movieFile = (raw.movieFile ?? {}) as Record<string, unknown>;
  const quality = (movieFile.quality ?? raw.quality) as Record<string, unknown> | undefined;
  const q = (quality?.quality ?? quality) as Record<string, unknown> | undefined;
  const mediaInfo = (movieFile.mediaInfo ?? {}) as Record<string, unknown>;
  const filePath = typeof movieFile.path === "string" ? movieFile.path : "";
  const folderPath = typeof raw.path === "string" ? raw.path : null;
  return {
    externalId: Number(raw.id),
    title: String(raw.title ?? "Untitled"),
    path: filePath,
    folderPath,
    quality: typeof q?.name === "string" ? q.name : null,
    videoCodec: typeof mediaInfo.videoCodec === "string" ? mediaInfo.videoCodec : null,
    resolution: resolutionOf(q, mediaInfo, filePath),
    hdr: hdrOf(mediaInfo),
    size: typeof movieFile.size === "number" ? movieFile.size : null,
  };
}

function resolutionOf(
  quality: Record<string, unknown> | undefined,
  mediaInfo: Record<string, unknown>,
  path: string,
): string | null {
  if (typeof quality?.resolution === "number") return String(quality.resolution);
  if (typeof mediaInfo.width === "number") return String(mediaInfo.width);
  const m = path.match(/(2160|1080|720|480)p/i);
  return m ? m[1] : null;
}

function hdrOf(mediaInfo: Record<string, unknown>): string | null {
  const dyn = String(mediaInfo.videoDynamicRangeType ?? mediaInfo.videoDynamicRange ?? "").toLowerCase();
  if (dyn.includes("dolby") || dyn.includes("dv")) return "dolby_vision";
  if (dyn.includes("hdr10+")) return "hdr10plus";
  if (dyn.includes("hdr")) return "hdr10";
  return dyn || null;
}

function parseEpisode(raw: Record<string, unknown>, seriesTitle: string): ArrMovie | null {
  const episodeFile = (raw.episodeFile ?? {}) as Record<string, unknown>;
  const filePath = typeof episodeFile.path === "string" ? episodeFile.path : "";
  if (!raw.id) return null;
  const quality = (episodeFile.quality ?? {}) as Record<string, unknown>;
  const q = (quality.quality ?? quality) as Record<string, unknown>;
  const mediaInfo = (episodeFile.mediaInfo ?? {}) as Record<string, unknown>;
  const epTitle = raw.title ? `${seriesTitle} - ${raw.title}` : seriesTitle;
  return {
    externalId: Number(raw.id),
    title: String(epTitle),
    path: filePath,
    folderPath: typeof raw.path === "string" ? raw.path : null,
    quality: typeof q?.name === "string" ? q.name : null,
    videoCodec: typeof mediaInfo.videoCodec === "string" ? mediaInfo.videoCodec : null,
    resolution: resolutionOf(q, mediaInfo, filePath),
    hdr: hdrOf(mediaInfo),
    size: typeof episodeFile.size === "number" ? episodeFile.size : null,
  };
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}
