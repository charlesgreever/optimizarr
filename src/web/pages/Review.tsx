import { useEffect, useState } from "react";
import { api } from "../api";

type ReviewRow = {
  id: number;
  title: string;
  displayTitle?: string;
  sourcePath: string;
  sidecarPath: string;
  compare: { source?: { size?: number; duration?: number; codec?: string }; sidecar?: { size?: number; duration?: number } };
};

export function Review() {
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await api.review();
    setItems(data.items as ReviewRow[]);
    setMessage(data.message || "");
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Review</h1>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {items.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-sm text-zinc-400">
          {message || "Finished sidecars wait here for Keep or Discard."}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-zinc-800 p-5">
              <h2 className="font-medium">{item.displayTitle || item.title}</h2>
              <div className="mt-3 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
                <div>
                  <div className="text-xs uppercase text-zinc-500">Original</div>
                  <div>codec {item.compare.source?.codec ?? "—"}</div>
                  <div>size {item.compare.source?.size ?? "—"}</div>
                  <div className="truncate">{item.sourcePath}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500">Sidecar</div>
                  <div>duration {item.compare.sidecar?.duration ?? "—"}s</div>
                  <div>size {item.compare.sidecar?.size ?? "—"}</div>
                  <div className="truncate">{item.sidecarPath}</div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  className="btn !w-auto"
                  type="button"
                  onClick={() => void api.keepReview(item.id).then(load).catch((e: Error) => setError(e.message))}
                >
                  Keep
                </button>
                <button
                  className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                  type="button"
                  onClick={() => void api.discardReview(item.id).then(load)}
                >
                  Discard
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
