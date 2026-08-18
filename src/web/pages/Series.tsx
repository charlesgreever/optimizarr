import { useEffect, useMemo, useState } from "react";
import { api, formatSize, type LibraryRow } from "../api";
import { Help } from "../components/Shell";
import { RowActions } from "../components/RowActions";

export function SeriesPage() {
  const [items, setItems] = useState<LibraryRow[]>([]);
  const [msg, setMsg] = useState("");
  const load = () => void api.series().then((r) => setItems(r.items));
  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryRow[]>();
    for (const item of items) {
      const key = `${item.instanceName}::${item.showTitle ?? item.displayTitle}`;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Series</h1>
      <Help>Episode rows use the same actions as movies. Optimize all episodes queues every episode of that show that already has open work.</Help>
      {groups.length === 0 ? (
        <div className="glass mt-6 p-5 text-sm text-slate-300">No series yet. Connect Sonarr in Settings and refresh the library.</div>
      ) : (
        groups.map(([key, eps]) => {
          const head = eps[0];
          return (
            <div key={key} className="glass mt-5 overflow-x-auto p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
                <div>
                  <div className="font-semibold">{head.showTitle}</div>
                  <div className="text-xs text-slate-400">{head.instanceName} · {eps.length} episodes</div>
                </div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void api
                      .optimizeShow(head.instanceId, head.showTitle ?? "")
                      .then((r) => {
                        setMsg(`Queued ${Number((r as { queued: number }).queued)}. Skipped ${Number((r as { skipped: number }).skipped)}.`);
                        load();
                      })
                      .catch((e: Error) => setMsg(e.message));
                  }}
                >
                  Optimize all episodes
                </button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Episode</th>
                    <th>Quality</th>
                    <th>Size</th>
                    <th>Plan</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {eps.map((item) => (
                    <tr key={item.id} id={item.id}>
                      <td>{item.displayTitle}</td>
                      <td>{item.quality || "—"}</td>
                      <td>{formatSize(item.sizeBytes)}</td>
                      <td className="text-sm text-slate-300">{item.error || item.reasons[0] || (item.inspected ? "Healthy" : "Waiting for inspect")}</td>
                      <td>
                        <RowActions item={item} onDone={load} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
      {msg && <p className="mt-3 text-sm text-slate-300">{msg}</p>}
    </section>
  );
}
