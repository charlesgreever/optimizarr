import type { Store, LibrarySnapshot } from "./store.ts";
import { displayTitle } from "./titles.ts";

export type Page<T> = {
  items: T[];
  nextOffset: number | null;
  total: number;
};

export function createLibraryReadModel(store: Store) {
  return {
    movies(offset: number, limit: number, sort: "title" | "size" | "quality" = "title") {
      const page = store.libraryPage({ type: "movie", offset, limit, sort });
      return presentPage(page, offset, limit);
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
      return presentPage(page, offset, limit);
    },
    item(id: string, detail = false) {
      const snapshot = store.librarySnapshot(id);
      return snapshot ? presentLibraryItem(snapshot, detail) : undefined;
    },
  };
}

function presentPage(
  page: { rows: LibrarySnapshot[]; total: number },
  offset: number,
  limit: number,
): Page<ReturnType<typeof presentLibraryItem>> {
  return {
    items: page.rows.map((row) => presentLibraryItem(row)),
    nextOffset: nextOffset(offset, limit, page.total),
    total: page.total,
  };
}

function nextOffset(offset: number, limit: number, total: number): number | null {
  const next = offset + limit;
  return next < total ? next : null;
}

export function presentLibraryItem(snapshot: LibrarySnapshot, detail = false) {
  const { item, report, suggestion } = snapshot;
  const error = snapshot.error ?? (!item.path && item.type === "episode"
    ? "Sonarr did not send a file path. Refresh the library."
    : null);
  return {
    ...item,
    displayTitle: displayTitle(item),
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
    audioLabels: report?.audio.map((track) => `${track.language} ${track.codec} ${audioLayout(track.channels)}`) ?? [],
    subtitleLabels: report?.subtitles.map((track) => {
      const labels = [track.language, track.codec];
      if (track.forced) labels.push("Forced");
      if (track.sdh) labels.push("SDH");
      return labels.join(" ");
    }) ?? [],
    trackEditingAvailable: report?.listingState === "complete",
  };
}

function audioLayout(channels: number): string {
  if (channels === 1) return "Mono";
  if (channels === 2) return "2.0";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return channels > 0 ? `${channels} ch` : "Unknown layout";
}
