import { useState } from "react";
import { api, formatSize, type ReviewRow } from "../api";
import { PagedListControls } from "../components/PagedListControls";
import { Help, PageHead } from "../components/Shell";
import { usePagedList } from "../use-paged-list";

export function ReviewPage() {
  const list = usePagedList({ loadPage: api.review, keyOf: (row: ReviewRow) => row.id, pollMs: 3000 });
  const items = list.items;
  const [selected, setSelected] = useState<Record<string, boolean>>();
  const [msg, setMsg] = useState("");

  const pending = items.filter((i) => i.status === "pending");
  const chosen = pending.filter((i) => selected?.[i.id]);

  return (
    <section>
      <PageHead title="Review">
        <button
          className="btn"
          type="button"
          disabled={chosen.length === 0}
          onClick={() => void api.keepSelected(chosen.map((i) => i.id)).then((r) => {
            setMsg(`Keep started for ${(r as { accepted: number }).accepted}.`);
            setSelected({});
            return list.reload();
          })}
        >
          Keep selected ({chosen.length})
        </button>
      </PageHead>
      <Help>
        Review compares the original and the sidecar. Keep replaces the library file. Discard throws the sidecar away. The original stays until Keep finishes. If Polisharr restarts during Keep, the card comes back so you can try again, unless the new file is already in the library.
      </Help>
      {items.length === 0 && list.loading && <div className="empty">Loading review…</div>}
      {items.length === 0 && !list.loading && !list.error && <div className="empty">Nothing is waiting for Keep or Discard.</div>}
      {items.length > 0 && (
        <ul className="mt-5 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="glass p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  disabled={item.status !== "pending"}
                  checked={Boolean(selected?.[item.id])}
                  onChange={(e) => setSelected((s) => ({ ...s, [item.id]: e.target.checked }))}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{item.displayTitle}</div>
                  {item.flagged && <div className="text-sm text-amber-300">{item.flagReason}</div>}
                  {item.error && <div className="text-sm text-rose-400">{item.error}</div>}
                  <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <div>Now: {item.source.codec} · {formatSize(item.source.sizeBytes)} · {item.source.tracks}</div>
                    <div>Sidecar: {item.sidecar.codec} · {formatSize(item.sidecar.sizeBytes)} · {item.sidecar.tracks}</div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button className="btn" type="button" disabled={item.status !== "pending"} onClick={() => void api.keep(item.id).then(list.reload)}>
                      {item.status === "keeping" ? "Keeping…" : "Keep"}
                    </button>
                    <button className="btn-secondary danger" type="button" disabled={item.status !== "pending"} onClick={() => void api.discard(item.id).then(list.reload)}>
                      Discard
                    </button>
                  </div>
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}
      <PagedListControls loading={list.loading} error={list.error} nextOffset={list.nextOffset} noun="reviews" onLoadMore={list.loadMore} onRetry={list.reload} />
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </section>
  );
}
