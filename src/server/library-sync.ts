import { resolve } from "node:path";
import {
  fetchJson,
  parseRadarrMovies,
  parseRootFolders,
  parseSonarrEpisodes,
  parseSonarrSeries,
  trimUrl,
} from "./arr.ts";
import type { Store, StoredInstance } from "./store.ts";

export type LibrarySyncResult = { ok: true; errors: string[] };

export type LibrarySyncOptions = {
  store: Store;
  fetch: typeof fetch;
  decrypt: (packed: string) => string;
  inspectPending: () => Promise<void>;
  intervalMs?: number;
};

export class LibrarySync {
  private inFlight: Promise<LibrarySyncResult> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: LibrarySyncOptions) {}

  start(): void {
    this.refreshInBackground();
    const intervalMs = this.options.intervalMs ?? 15 * 60 * 1_000;
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => this.refreshInBackground(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  refresh(): Promise<LibrarySyncResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private refreshInBackground(): void {
    void this.refresh().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`The library sync could not start because ${message}`);
    });
  }

  private async performRefresh(): Promise<LibrarySyncResult> {
    const errors: string[] = [];
    for (const instance of this.options.store.listInstances()) {
      if (!instance.enabled || !instance.secret || (instance.kind !== "radarr" && instance.kind !== "sonarr")) continue;
      try {
        await this.refreshInstance(instance, this.options.decrypt(instance.secret), errors);
      } catch (error) {
        errors.push(`${instance.name}: ${error instanceof Error ? error.message : "Sync failed."}`);
      }
    }
    void this.options.inspectPending().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`The library inspector could not start after sync because ${message}`);
    });
    return { ok: true, errors };
  }

  private async refreshInstance(instance: StoredInstance, key: string, errors: string[]): Promise<void> {
    const roots = await this.refreshRoots(instance, key);
    const reviewPath = this.options.store.getSettings().reviewPath;
    if (reviewPath && roots.some((root) => pathsOverlap(reviewPath, root))) {
      errors.push(`${instance.name}: The review folder overlaps this Arr library.`);
      return;
    }
    if (instance.kind === "radarr") {
      const movies = parseRadarrMovies(await fetchJson(`${trimUrl(instance.url)}/api/v3/movie`, key, this.options.fetch));
      for (const movie of movies) {
        const id = `${instance.id}:movie:${movie.id}`;
        this.options.store.upsertItem({
          id, instanceId: instance.id, arrId: movie.id, arrSeriesId: null, arrEpisodeFileId: null, type: "movie",
          title: movie.title, showTitle: null, season: null, episode: null, episodeTitle: null, path: movie.path,
          sizeBytes: movie.size, quality: movie.quality, resolution: movie.resolution, profile: movie.profile,
          tags: movie.tags, posterRemoteUrl: movie.posterUrl,
          sizeExempt: this.options.store.getItem(id)?.sizeExempt ?? false,
        });
      }
      return;
    }
    const series = parseSonarrSeries(await fetchJson(`${trimUrl(instance.url)}/api/v3/series`, key, this.options.fetch));
    for (const show of series) {
      const episodes = parseSonarrEpisodes(
        await fetchJson(`${trimUrl(instance.url)}/api/v3/episode?seriesId=${show.id}&includeEpisodeFile=true`, key, this.options.fetch),
        show.title, show.posterUrl, show.profile, show.tags,
      );
      for (const episode of episodes) {
        const id = `${instance.id}:episode:${episode.id}`;
        this.options.store.upsertItem({
          id, instanceId: instance.id, arrId: episode.id, arrSeriesId: episode.seriesId,
          arrEpisodeFileId: episode.episodeFileId, type: "episode", title: episode.seriesTitle,
          showTitle: episode.seriesTitle, season: episode.season, episode: episode.episode,
          episodeTitle: episode.episodeTitle, path: episode.path, sizeBytes: episode.size, quality: episode.quality,
          resolution: episode.resolution, profile: episode.profile, tags: episode.tags,
          posterRemoteUrl: episode.posterUrl, sizeExempt: this.options.store.getItem(id)?.sizeExempt ?? false,
        });
      }
    }
  }

  private async refreshRoots(instance: StoredInstance, key: string): Promise<string[]> {
    try {
      const roots = parseRootFolders(
        await fetchJson(`${trimUrl(instance.url)}/api/v3/rootfolder`, key, this.options.fetch),
      );
      this.options.store.replaceLibraryRoots(instance.id, roots);
      return roots;
    } catch {
      return this.options.store.listLibraryRoots(instance.id);
    }
  }
}

export function pathsOverlap(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
