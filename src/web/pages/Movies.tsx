import { useEffect, useState } from "react";
import { api, type LibraryItem } from "../api";

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export function Movies() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [message, setMessage] = useState("Loading…");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Movies</h1>
        <button className="btn !w-auto" type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Syncing…" : "Refresh library"}
        </button>
      </div>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {items.length === 0 ? (
        <div className="max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
          <p className="text-sm leading-6 text-zinc-400">{message}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500">
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
                <tr key={item.id} className="border-t border-zinc-800">
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
                    <button
                      className="mt-1 text-xs text-amber-400 hover:text-amber-300"
                      type="button"
                      onClick={() => void api.forceItem(item.id)}
                    >
                      Force suggestion
                    </button>
                    <button
                      className="ml-3 mt-1 text-xs text-amber-400 hover:text-amber-300"
                      type="button"
                      onClick={() => void api.addStereo(item.id)}
                    >
                      Add stereo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
