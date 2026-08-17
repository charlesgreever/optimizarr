import { useEffect, useState } from "react";
import { api, type LibraryItem } from "../api";
import { LibraryActions } from "../components/LibraryActions";
import { Poster } from "../components/Poster";
import { formatSize } from "../format";

export function Movies() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [message, setMessage] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"cards" | "list">("cards");

  async function load() {
    const data = await api.movies();
    const next = data.items ?? [];
    if (next.length > 0 || items.length === 0) {
      setItems(next);
      setMessage(data.message || "No movies synced yet.");
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
          <h1 className="page-title">Movies</h1>
          <p className="page-description">Browse synced titles, inspect their current format, and choose what Optimizarr should improve.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary !py-2"
            type="button"
            onClick={() => setView((v) => (v === "cards" ? "list" : "cards"))}
          >
            {view === "cards" ? "Compact list" : "Cards"}
          </button>
          <button className="btn !w-auto" type="button" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Syncing…" : "Refresh library"}
          </button>
        </div>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {items.length === 0 ? (
        <div className="empty-panel">
          <p className="text-sm leading-6 text-zinc-400">{message}</p>
        </div>
      ) : view === "list" ? (
        <MovieTable items={items} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="panel group flex gap-4 overflow-hidden p-3.5 transition hover:-translate-y-0.5 hover:border-white/[0.13] hover:bg-zinc-900/75">
              <Poster itemId={item.id} hasPoster={item.hasPoster} alt="" className="h-32 w-[5.3rem] rounded-xl shadow-lg shadow-black/30" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-semibold tracking-[-0.01em] text-zinc-100">{item.title}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="meta-pill">{item.quality ?? "Unknown quality"}</span>
                  <span className="meta-pill">{item.videoCodec ?? "Unknown codec"}</span>
                  <span className="meta-pill">{formatSize(item.size)}</span>
                </div>
                <div className="mt-2 text-[0.68rem] font-medium uppercase tracking-wider text-zinc-600">{item.instanceName}</div>
                <div className="mt-1 truncate text-xs text-zinc-600" title={item.path}>
                  {item.path || "—"}
                </div>
                {!item.readable && item.pathError && (
                  <div className="mt-1 text-xs text-amber-400">{item.pathError}</div>
                )}
                <LibraryActions
                  itemId={item.id}
                  readable={item.readable}
                  pathError={item.pathError}
                  titleQuery={item.title}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MovieTable({ items }: { items: LibraryItem[] }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-white/[0.025] text-[0.68rem] uppercase tracking-[0.14em] text-zinc-500">
          <tr>
            <th className="px-4 py-3">Title</th>
            <th className="px-4 py-3">Instance</th>
            <th className="px-4 py-3">Quality</th>
            <th className="px-4 py-3">Codec</th>
            <th className="px-4 py-3">Size</th>
            <th className="px-4 py-3">Path</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-white/[0.06] transition hover:bg-white/[0.025]">
              <td className="px-4 py-3 font-medium">{item.title}</td>
              <td className="px-4 py-3 text-zinc-400">{item.instanceName}</td>
              <td className="px-4 py-3 text-zinc-400">{item.quality ?? "—"}</td>
              <td className="px-4 py-3 text-zinc-400">{item.videoCodec ?? "—"}</td>
              <td className="px-4 py-3 text-zinc-400">{formatSize(item.size)}</td>
              <td className="max-w-md px-4 py-3">
                <div className="truncate text-zinc-400" title={item.path}>
                  {item.path || "—"}
                </div>
                {!item.readable && item.pathError && (
                  <div className="mt-1 text-xs text-amber-400">{item.pathError}</div>
                )}
                <LibraryActions
                  itemId={item.id}
                  readable={item.readable}
                  pathError={item.pathError}
                  titleQuery={item.title}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
