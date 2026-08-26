import type { Store, LibrarySnapshot } from "./store.ts";
import type { LibraryItem } from "./types.ts";
import { displayTitle, sharedFileLabel } from "./titles.ts";
import { audioTrackLabel, subtitleTrackLabel } from "./tracks.ts";

export type Page<T> = {
  items: T[];
  nextOffset: number | null;
  total: number;
  healthyCount?: number;
  suggestionCount?: number;
};

export function createLibraryReadModel(store: Store) {
  return {
    movies(offset: number, limit: number, sort: "title" | "size" | "quality" = "title") {
      const page = store.libraryPage({ type: "movie", offset, limit, sort });
      const health = store.movieHealth();
      return { ...presentPage(store, page, offset, limit), healthyCount: health.healthyCount, suggestionCount: health.suggestionCount };
    },
    series(offset: number, limit: number) {
      const page = store.seriesPage(offset, limit);
      return {
        items: page.rows.map((row) => ({
          ...row,
          id: `${row.instanceId}:${row.arrSeriesId}`,
          key: `${row.instanceId}:${row.arrSeriesId}`,
        })),
        nextOffset: nextOffset(offset, limit, page.total),
        total: page.total,
      };
    },
    episodes(instanceId: string, arrSeriesId: number, offset: number, limit: number) {
      const page = store.libraryPage({ type: "episode", instanceId, arrSeriesId, offset, limit });
      return presentPage(store, page, offset, limit);
    },
    item(id: string, detail = false) {
      const snapshot = store.librarySnapshot(id);
      if (!snapshot) return undefined;
      return presentLibraryItem(snapshot, detail, store.itemsForPath(snapshot.item.path, snapshot.item.instanceId));
    },
  };
}

function presentPage(
  store: Store,
  page: { rows: LibrarySnapshot[]; total: number },
  offset: number,
  limit: number,
): Page<ReturnType<typeof presentLibraryItem>> {
  return {
    items: page.rows.map((row) => presentLibraryItem(row, false, store.itemsForPath(row.item.path, row.item.instanceId))),
    nextOffset: nextOffset(offset, limit, page.total),
    total: page.total,
  };
}

function nextOffset(offset: number, limit: number, total: number): number | null {
  const next = offset + limit;
  return next < total ? next : null;
}

export function presentLibraryItem(snapshot: LibrarySnapshot, detail = false, siblings: LibraryItem[] = []) {
  const { item, report, suggestion } = snapshot;
  const error = snapshot.error ?? (!item.path && item.type === "episode"
    ? "Sonarr did not send a file path. Refresh the library."
    : null);
  return {
    ...item,
    displayTitle: displayTitle(item),
    sharedFileLabel: sharedFileLabel(item, siblings),
    inspected: Boolean(report),
    mediaState: error ? "unreadable" as const : report ? "inspected" as const : "waiting" as const,
    report: detail ? report : undefined,
    suggestion: suggestion
      ? { id: suggestion.id, actions: suggestion.actions, reasons: suggestion.reasons }
      : null,
    error,
    reasons: suggestion?.reasons ?? [],
    href: item.type === "movie" ? `/movies/${item.id}` : `/series/episodes/${item.id}`,
    listingState: report?.listingState ?? null,
    sourceMethod: report?.sourceMethod ?? null,
    videoLabel: report ? `${report.videoCodec} · ${report.width}x${report.height}` : null,
    audioLabels: report?.audio.map((track) => audioTrackLabel(track).replace(/^Audio: /, "")) ?? [],
    subtitleLabels: report?.subtitles.map((track) => subtitleTrackLabel(track).replace(/^Subtitle: /, "")) ?? [],
    trackEditingAvailable: report?.listingState === "complete",
  };
}
