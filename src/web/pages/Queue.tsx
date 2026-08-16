import { useEffect, useState } from "react";
import { api } from "../api";

export function Queue() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api
      .queue()
      .then((d) => {
        setItems(d.items as Array<Record<string, unknown>>);
        setMessage(d.message || "");
      })
      .catch((e: Error) => setMessage(e.message));
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
      {items.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-sm text-zinc-400">
          {message || "Approved work will appear here."}
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((job) => (
            <li key={String(job.id)} className="rounded-lg border border-zinc-800 px-4 py-3 text-sm">
              <span className="font-medium">{String(job.title)}</span>
              <span className="ml-2 text-zinc-500">{String(job.status)}</span>
              {job.error ? <div className="mt-1 text-xs text-red-400">{String(job.error)}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
