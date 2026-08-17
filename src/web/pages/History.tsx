import { useEffect, useState } from "react";
import { api } from "../api";

export function History() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.history().then((d) => {
      setItems(d.items as Array<Record<string, unknown>>);
      setMessage(d.message || "");
    });
  }, []);

  return (
    <section>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Activity</div>
          <h1 className="page-title">History</h1>
          <p className="page-description">A record of finished, kept, discarded, flagged, and failed work.</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty-panel text-sm text-zinc-400">
          {message || "Completed jobs will be listed here."}
        </div>
      ) : (
        <ul className="space-y-3 text-sm">
          {items.map((row) => (
            <li key={String(row.id)} className="panel flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div>
                <div className="font-semibold">{String(row.title)}</div>
                {row.detail ? <div className="mt-1 text-xs text-zinc-500">{String(row.detail)}</div> : null}
              </div>
              <span className="meta-pill capitalize">{String(row.action)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
