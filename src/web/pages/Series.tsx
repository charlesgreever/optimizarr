import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatSize, type LibraryRow } from "../api";
import { Help, PageHead } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";
import { RowActions } from "../components/RowActions";

export function SeriesPage() {
  const [items, setItems] = useState<LibraryRow[]>([]);
  const [msg, setMsg] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [searchParams] = useSearchParams();
  const focus = searchParams.get("focus");

  const load = () => void api.series().then((r) => setItems(r.items)).catch((e: Error) => setMsg(e.message));
  useEffect(() => {
    load();
    void api.refresh().then(load).catch((e: Error) => {
      setMsg(e.message);
      load();
    });
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryRow[]>();
    for (const item of items) {
      const key = `${item.instanceId}::${item.showTitle || item.title || item.displayTitle}`;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  useEffect(() => {
    if (!focus) return;
    const match = groups.find(([, eps]) => eps.some((ep) => ep.id === focus));
    if (!match) return;
    setCollapsed((current) => {
      if (!current.has(match[0])) return current;
      const next = new Set(current);
      next.delete(match[0]);
      return next;
    });
  }, [focus, groups]);

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section>
      <PageHead title="Series">
        <RefreshLibrary onDone={load} />
      </PageHead>
      <Help>Use Collapse on a show, or click the show title, to hide its episode table. Optimize all episodes queues that show without collapsing it.</Help>
      {groups.length === 0 ? (
        <div className="empty">
          <div className="space-y-3">
            <p>No series loaded yet. Refresh pulls episodes from the Sonarr connections in Settings.</p>
            <RefreshLibrary onDone={load} />
          </div>
        </div>
      ) : (
        groups.map(([key, eps]) => {
          const head = eps[0];
          const open = !collapsed.has(key);
          return (
            <div key={key} className="glass series-block mt-5">
              <div className="series-head">
                <button type="button" className="series-toggle" aria-expanded={open} onClick={() => toggle(key)}>
                  <span className="series-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
                  <span>
                    <span className="series-title">{head.showTitle || head.title || head.displayTitle}</span>
                    <span className="series-meta">{head.instanceName} · {eps.length} episodes</span>
                  </span>
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => toggle(key)}
                >
                  {open ? "Collapse" : "Expand"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void api.optimizeShow(head.instanceId, head.showTitle ?? "").then((r) => {
                      setMsg(`Queued ${Number((r as { queued: number }).queued)}. Skipped ${Number((r as { skipped: number }).skipped)}.`);
                      load();
                    }).catch((e: Error) => setMsg(e.message));
                  }}
                >
                  Optimize all episodes
                </button>
              </div>
              {open && (
                <div className="series-table-wrap">
                  <table className="dense">
                    <thead>
                      <tr>
                        <th>Episode</th>
                        <th>Video</th>
                        <th>Audio</th>
                        <th>Subs</th>
                        <th>Quality</th>
                        <th>Size</th>
                        <th>Plan</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eps.map((item) => (
                        <tr key={item.id} id={item.id}>
                          <td>
                            <Link to={item.href || `/series/episodes/${item.id}`}>{item.displayTitle}</Link>
                          </td>
                          <td className="text-sm">{item.videoLabel || "—"}</td>
                          <td className="max-w-40 truncate text-sm">{item.audioLabels?.join(", ") || "—"}</td>
                          <td className="max-w-32 truncate text-sm">{item.subtitleLabels?.join(", ") || "—"}</td>
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
              )}
            </div>
          );
        })
      )}
      {msg && <p className="mt-3 text-sm text-slate-300">{msg}</p>}
    </section>
  );
}
