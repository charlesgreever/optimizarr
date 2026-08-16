import { accessSync, constants } from "node:fs";
import { ArrClient, ArrError } from "./arr.ts";
import type { Catalog } from "./catalog.ts";
import type { JobService } from "./jobs.ts";
import type { ArrInstance, LibraryItem } from "./models.ts";
import type { Store } from "./store.ts";

export type PathCheck = (path: string) => boolean;

export const UNREADABLE =
  "Path is not readable inside the container. Check that Optimizarr has the same network path mounted as this Arr.";
export const NO_FILE = "Radarr has no file for this title yet.";

export function noFileMessage(kind: ArrInstance["kind"]): string {
  return kind === "sonarr" ? "Sonarr has no file for this episode yet." : NO_FILE;
}

export function defaultPathReadable(path: string): boolean {
  if (!path) return false;
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export class LibrarySync {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  lastSyncAt: string | null = null;
  lastError: string | null = null;

  catalog: Catalog | undefined;
  jobs: JobService | undefined;

  constructor(
    private store: Store,
    private client: ArrClient,
    private pathReadable: PathCheck = defaultPathReadable,
    private now: () => Date = () => new Date(),
  ) {}

  start(intervalMs = 5 * 60 * 1000): void {
    this.stop();
    this.timer = setInterval(() => {
      void this.refreshAll({ inspect: "pending" }).catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refreshAll(opts?: { inspect?: "pending" | "none" }): Promise<{ movies: number; errors: string[] }> {
    if (this.running) return { movies: 0, errors: ["sync already running"] };
    this.running = true;
    const errors: string[] = [];
    let movies = 0;
    const autoIds = new Set<number>();
    try {
      for (const instance of this.store.listArrInstances()) {
        if (!instance.enabled) continue;
        try {
          if (instance.kind === "radarr") movies += await this.refreshKind(instance, "movie", autoIds);
          else if (instance.kind === "sonarr") movies += await this.refreshKind(instance, "episode", autoIds);
        } catch (err) {
          const message = err instanceof ArrError ? err.message : err instanceof Error ? err.message : "sync failed";
          errors.push(`${instance.name}: ${message}`);
        }
      }
      const inspect = opts?.inspect ?? "pending";
      if (this.catalog && inspect !== "none") {
        try {
          await this.catalog.inspectPending();
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (this.jobs && this.store.getSettings().autoOptimize) {
        for (const suggestion of this.store.listSuggestions()) {
          if (autoIds.has(suggestion.itemId as number)) {
            await this.jobs.enqueue(suggestion.id as number);
          }
        }
      }
      this.lastSyncAt = this.now().toISOString();
      this.lastError = errors[0] ?? this.lastError;
      return { movies, errors };
    } finally {
      this.running = false;
    }
  }

  async refreshKind(instance: ArrInstance, type: "movie" | "episode", autoIds?: Set<number>): Promise<number> {
    const remote = type === "movie" ? await this.client.listMovies(instance) : await this.client.listEpisodes(instance);
    if (remote.length === 0 && this.store.countLibraryItems(instance.id, type) > 0) {
      throw new ArrError(`${instance.name} returned no ${type}s; keeping the existing library`);
    }
    const updatedAt = this.now().toISOString();
    for (const movie of remote) {
      const hasPath = Boolean(movie.path);
      const previous = this.store.getLibraryItemByExternal(instance.id, type, movie.externalId);
      const readable =
        previous && previous.path === movie.path
          ? previous.readable
          : hasPath && this.pathReadable(movie.path);
      const saved = this.store.upsertLibraryItem({
        instanceId: instance.id,
        externalId: movie.externalId,
        seriesId: movie.seriesId,
        type,
        title: movie.title,
        seriesTitle: type === "episode" ? movie.seriesTitle : null,
        seasonNumber: movie.seasonNumber ?? null,
        episodeNumber: movie.episodeNumber ?? null,
        path: movie.path || movie.folderPath || "",
        folderPath: movie.folderPath,
        quality: movie.quality,
        videoCodec: movie.videoCodec,
        resolution: movie.resolution,
        hdr: movie.hdr,
        size: movie.size,
        readable,
        pathError: hasPath ? (readable ? null : UNREADABLE) : noFileMessage(instance.kind),
        updatedAt,
      });
      if (!previous || previous.path !== movie.path) autoIds?.add(saved.id);
    }
    this.store.removeMissingLibraryItems(
      instance.id,
      type,
      remote.map((m) => m.externalId),
    );
    return remote.length;
  }
}

export function libraryListPayload(items: LibraryItem[], lastSyncAt: string | null, empty: string) {
  if (items.length === 0) {
    return { items, lastSyncAt, message: empty };
  }
  return { items, lastSyncAt };
}
