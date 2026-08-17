import { useEffect, useMemo, useState } from "react";
import { api, type LibraryItem } from "../api";
import { LibraryActions } from "../components/LibraryActions";
import { Poster } from "../components/Poster";
import { formatSize } from "../format";

type SeasonGroup = { season: number; episodes: LibraryItem[] };
type SeriesGroup = {
  key: string;
  title: string;
  instanceName: string;
  posterItem: LibraryItem | undefined;
  seasons: SeasonGroup[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function seasonLabel(n: number): string {
  return n === 0 ? "Specials" : `Season ${n}`;
}

function groupSeries(items: LibraryItem[]): SeriesGroup[] {
  const bySeries = new Map<string, LibraryItem[]>();
  for (const item of items) {
    const title = item.seriesTitle || item.title;
    const key = `${item.instanceName}::${title}`;
    const list = bySeries.get(key) ?? [];
    list.push(item);
    bySeries.set(key, list);
  }
  return [...bySeries.entries()]
    .map(([key, eps]) => {
      const title = eps[0].seriesTitle || eps[0].title;
      const seasons = new Map<number, LibraryItem[]>();
      for (const ep of eps) {
        const season = ep.seasonNumber ?? 0;
        const list = seasons.get(season) ?? [];
        list.push(ep);
        seasons.set(season, list);
      }
      return {
        key,
        title,
        instanceName: eps[0].instanceName,
        posterItem: eps.find((ep) => ep.hasPoster) ?? eps[0],
        seasons: [...seasons.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([season, episodes]) => ({
            season,
            episodes: [...episodes].sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)),
          })),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function Series() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openSeries, setOpenSeries] = useState<Record<string, boolean>>({});
  const [openSeason, setOpenSeason] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupSeries(items), [items]);

  async function load() {
    const data = await api.series();
    const next = (data.items as LibraryItem[]) ?? [];
    if (next.length > 0 || items.length === 0) {
      setItems(next);
      setMessage(data.message || "");
    }
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.refreshLibrary();
      if (result.errors.length) setError(result.errors.join(" "));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Library</div>
          <h1 className="page-title">Series</h1>
          <p className="page-description">Move from show to season to episode without losing the source, format, or optimization controls.</p>
        </div>
        <button className="btn !w-auto" type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Syncing…" : "Refresh library"}
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {groups.length === 0 ? (
        <div className="empty-panel text-sm text-zinc-400">
          {message || "Connect Sonarr in Settings to sync your library."}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((show) => {
            const seriesOpen = openSeries[show.key] ?? true;
            return (
              <article key={show.key} className="panel overflow-hidden">
                <button
                  type="button"
                  className="flex w-full items-center gap-4 bg-gradient-to-r from-white/[0.045] to-transparent px-4 py-3.5 text-left transition hover:bg-white/[0.055]"
                  onClick={() => setOpenSeries((s) => ({ ...s, [show.key]: !seriesOpen }))}
                >
                  {show.posterItem && (
                    <Poster
                      itemId={show.posterItem.id}
                      hasPoster={show.posterItem.hasPoster}
                      alt=""
                      className="h-16 w-11 rounded-lg shadow-md shadow-black/30"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold tracking-[-0.01em]">{show.title}</span>
                    <span className="mt-1 block text-[0.68rem] font-medium uppercase tracking-wider text-zinc-600">{show.instanceName}</span>
                  </span>
                  <span className="meta-pill">
                    {show.seasons.reduce((n, s) => n + s.episodes.length, 0)} episodes
                  </span>
                </button>
                {seriesOpen && (
                  <div className="border-t border-white/[0.07]">
                    {show.seasons.map((season) => {
                      const seasonKey = `${show.key}:${season.season}`;
                      const seasonOpen = openSeason[seasonKey] ?? true;
                      return (
                        <div key={seasonKey} className="border-t border-white/[0.055] first:border-t-0">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between px-5 py-2.5 text-left text-sm font-medium text-zinc-300 transition hover:bg-white/[0.025]"
                            onClick={() => setOpenSeason((s) => ({ ...s, [seasonKey]: !seasonOpen }))}
                          >
                            <span>{seasonLabel(season.season)}</span>
                            <span className="text-xs text-zinc-500">{season.episodes.length}</span>
                          </button>
                          {seasonOpen && (
                            <ul className="bg-black/15">
                              {season.episodes.map((ep) => (
                                <li key={ep.id} className="border-t border-white/[0.045] px-5 py-3 text-sm transition hover:bg-white/[0.018]">
                                  <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="font-mono text-xs text-amber-300">
                                      S{pad(ep.seasonNumber ?? 0)}E{pad(ep.episodeNumber ?? 0)}
                                    </span>
                                    <span>{ep.title}</span>
                                    <span className="text-xs text-zinc-500">
                                      {ep.videoCodec ?? "—"}
                                      {ep.quality ? ` · ${ep.quality}` : ""}
                                      {ep.size ? ` · ${formatSize(ep.size)}` : ""}
                                    </span>
                                  </div>
                                  <div className="truncate text-xs text-zinc-500" title={ep.path}>
                                    {ep.path || "No file"}
                                  </div>
                                  {!ep.readable && ep.pathError && (
                                    <div className="text-xs text-amber-400">{ep.pathError}</div>
                                  )}
                                  <LibraryActions
                                    itemId={ep.id}
                                    readable={ep.readable}
                                    pathError={ep.pathError}
                                    titleQuery={ep.seriesTitle || ep.title}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
