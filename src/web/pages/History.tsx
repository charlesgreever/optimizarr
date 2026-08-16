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
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      {items.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-sm text-zinc-400">
          {message || "Completed jobs will be listed here."}
        </div>
      ) : (
        <ul className="mt-6 space-y-2 text-sm">
          {items.map((row) => (
            <li key={String(row.id)} className="rounded-lg border border-zinc-800 px-4 py-3">
              <span className="font-medium">{String(row.title)}</span>
              <span className="ml-2 text-zinc-500">{String(row.action)}</span>
              {row.detail ? <div className="text-xs text-zinc-500">{String(row.detail)}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
