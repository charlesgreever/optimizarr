import { useEffect, useState } from "react";
import { api, formatSize, type ReviewRow } from "../api";
import { Help, PageHead } from "../components/Shell";

export function ReviewPage() {
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>();
  const [msg, setMsg] = useState("");
  const load = () => void api.review().then((r) => setItems(r.items));
  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const pending = items.filter((i) => i.status === "pending");
  const chosen = pending.filter((i) => selected?.[i.id]);

  return (
    <section>
      <PageHead title="Review">
        <button
          className="btn"
          type="button"
          disabled={chosen.length === 0}
          onClick={() => void api.keepSelected(chosen.map((i) => i.id)).then((r) => setMsg(`Keep started for ${(r as { accepted: number }).accepted}.`))}
        >
          Keep selected ({chosen.length})
        </button>
      </PageHead>
      <Help>
        Review compares the original and the sidecar. Keep replaces the library file. Discard throws the sidecar away. The original stays until Keep finishes.
      </Help>
      {items.length === 0 ? (
        <div className="empty">Nothing is waiting for Keep or Discard.</div>
      ) : (
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
                    <button className="btn" type="button" disabled={item.status !== "pending"} onClick={() => void api.keep(item.id).then(load)}>
                      {item.status === "keeping" ? "Keeping…" : "Keep"}
                    </button>
                    <button className="btn-secondary danger" type="button" disabled={item.status !== "pending"} onClick={() => void api.discard(item.id).then(load)}>
                      Discard
                    </button>
                  </div>
                </div>
              </label>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </section>
  );
}
