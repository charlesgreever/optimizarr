import { useEffect, useState } from "react";
import { api } from "../api";

type Job = {
  id: number;
  title?: string;
  displayTitle?: string;
  status?: string;
  error?: string | null;
  progress?: number;
};

const ACTIVE = new Set(["queued", "held", "running"]);

export function Queue() {
  const [items, setItems] = useState<Job[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    const data = await api.queue();
    setItems((data.items as Job[]) ?? []);
    setMessage(data.message || "");
  }

  useEffect(() => {
    load().catch((e: Error) => setMessage(e.message));
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  async function cancel(id: number) {
    setBusyId(id);
    setError(null);
    try {
      await api.cancelJob(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the job");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {items.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-sm text-zinc-400">
          {message || "Approved work will appear here."}
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((job) => (
            <li key={String(job.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{String(job.displayTitle || job.title || "Job")}</span>
                <span className="ml-2 text-zinc-500">{String(job.status)}</span>
                {job.error ? <div className="mt-1 text-xs text-red-400">{String(job.error)}</div> : null}
              </div>
              {ACTIVE.has(String(job.status)) && (
                <button
                  className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                  type="button"
                  disabled={busyId === job.id}
                  onClick={() => void cancel(job.id)}
                >
                  {busyId === job.id ? "Cancelling…" : "Cancel"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
