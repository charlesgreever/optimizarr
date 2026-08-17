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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Series</h1>
        <button className="btn !w-auto" type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Syncing…" : "Refresh library"}
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {groups.length === 0 ? (
        <div className="max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-sm text-zinc-400">
          {message || "Connect Sonarr in Settings to sync your library."}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((show) => {
            const seriesOpen = openSeries[show.key] ?? true;
            return (
              <article key={show.key} className="overflow-hidden rounded-xl border border-zinc-800">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 bg-zinc-900 px-4 py-3 text-left"
                  onClick={() => setOpenSeries((s) => ({ ...s, [show.key]: !seriesOpen }))}
                >
                  {show.posterItem && (
                    <Poster
                      itemId={show.posterItem.id}
                      hasPoster={show.posterItem.hasPoster}
                      alt=""
                      className="h-14 w-10 rounded"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{show.title}</span>
                    <span className="ml-2 text-xs text-zinc-500">{show.instanceName}</span>
                  </span>
                  <span className="text-xs text-zinc-500">
                    {show.seasons.reduce((n, s) => n + s.episodes.length, 0)} episodes
                  </span>
                </button>
                {seriesOpen && (
                  <div className="border-t border-zinc-800">
                    {show.seasons.map((season) => {
                      const seasonKey = `${show.key}:${season.season}`;
                      const seasonOpen = openSeason[seasonKey] ?? true;
                      return (
                        <div key={seasonKey} className="border-t border-zinc-800/80 first:border-t-0">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-900/80"
                            onClick={() => setOpenSeason((s) => ({ ...s, [seasonKey]: !seasonOpen }))}
                          >
                            <span>{seasonLabel(season.season)}</span>
                            <span className="text-xs text-zinc-500">{season.episodes.length}</span>
                          </button>
                          {seasonOpen && (
                            <ul className="bg-zinc-950/40">
                              {season.episodes.map((ep) => (
                                <li key={ep.id} className="border-t border-zinc-900 px-4 py-2 text-sm">
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
