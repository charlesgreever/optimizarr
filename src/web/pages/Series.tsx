import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatSize, type LibraryRow } from "../api";
import { Help, PageHead } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";
import { RowActions } from "../components/RowActions";

function groupKey(item: LibraryRow): string {
  if (item.arrSeriesId != null) return `${item.instanceId}::series:${item.arrSeriesId}`;
  return `${item.instanceId}::${item.showTitle || item.title || item.displayTitle}`;
}

export function SeriesPage() {
  const [items, setItems] = useState<LibraryRow[]>([]);
  const [msg, setMsg] = useState("");
  const [searchParams] = useSearchParams();
  const focus = searchParams.get("focus");

  const load = () => void api.series().then((r) => setItems(r.items)).catch((e: Error) => setMsg(e.message));
  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, LibraryRow[]>();
    for (const item of items) {
      const key = groupKey(item);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <section>
      <PageHead title="Series">
        <RefreshLibrary onDone={load} />
      </PageHead>
      <Help>Shows start collapsed so a large library does not freeze the browser. Expand a show to see episodes. Optimize all episodes queues that show without expanding it.</Help>
      {groups.length === 0 ? (
        <div className="empty">
          <div className="space-y-3">
            <p>No series loaded yet. Refresh pulls episodes from the Sonarr connections in Settings.</p>
            <RefreshLibrary onDone={load} />
          </div>
        </div>
      ) : (
        groups.map(([key, eps]) => (
          <SeriesGroup key={key} eps={eps} focusId={focus} onDone={load} onMsg={setMsg} />
        ))
      )}
      {msg && <p className="mt-3 text-sm text-slate-300">{msg}</p>}
    </section>
  );
}

function SeriesGroup({
  eps,
  focusId,
  onDone,
  onMsg,
}: {
  eps: LibraryRow[];
  focusId: string | null;
  onDone: () => void;
  onMsg: (msg: string) => void;
}) {
  const [open, setOpen] = useState(() => Boolean(focusId && eps.some((ep) => ep.id === focusId)));
  const head = eps[0];
  const title = head.showTitle || head.title || head.displayTitle;

  useEffect(() => {
    if (focusId && eps.some((ep) => ep.id === focusId)) setOpen(true);
  }, [focusId, eps]);

  return (
    <div className="glass series-block mt-5">
      <div className="series-head">
        <button
          type="button"
          className="series-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="series-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span>
            <span className="series-title">{title}</span>
            <span className="series-meta">{head.instanceName} · {eps.length} episodes</span>
          </span>
        </button>
        <button className="btn-secondary" type="button" onClick={() => setOpen((current) => !current)}>
          {open ? "Collapse" : "Expand"}
        </button>
        <button
          className="btn"
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void api.optimizeShow(head.instanceId, head.showTitle || head.title || "").then((r) => {
              onMsg(`Queued ${Number((r as { queued: number }).queued)}. Skipped ${Number((r as { skipped: number }).skipped)}.`);
              onDone();
            }).catch((e: Error) => onMsg(e.message));
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
                    <RowActions item={item} onDone={onDone} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
