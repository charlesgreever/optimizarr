import { useEffect, useState } from "react";
import { api } from "../api";

type Job = {
  id: number;
  title?: string;
  displayTitle?: string;
  status?: string;
  phase?: string;
  phaseLabel?: string;
  error?: string | null;
  progress?: number;
  etaSec?: number | null;
};

const ACTIVE = new Set(["queued", "held", "running"]);
const WAITING = new Set(["queued", "held"]);

function formatEta(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 60) return "Less than a minute left";
  if (sec < 3600) return `About ${Math.round(sec / 60)} min left`;
  const hours = Math.round(sec / 3600);
  return hours === 1 ? "About 1 hour left" : `About ${hours} hours left`;
}

function percent(progress: number | undefined): number | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

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
          {items.map((job) => {
            const status = String(job.status ?? "");
            const waiting = WAITING.has(status);
            const showBar = status === "running" && !waiting;
            const pct = percent(job.progress);
            const eta = formatEta(job.etaSec);
            const label = job.phaseLabel || String(job.phase || status);
            return (
              <li
                key={String(job.id)}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 px-4 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{String(job.displayTitle || job.title || "Job")}</span>
                  <span className="ml-2 text-zinc-500">{label}</span>
                  {showBar && pct != null && (
                    <div className="mt-2 max-w-md">
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {pct}%
                        {eta ? ` · ${eta}` : ""}
                      </div>
                    </div>
                  )}
                  {status === "failed" && job.phaseLabel && (
                    <div className="mt-1 text-xs text-red-400">Failed while {job.phaseLabel.toLowerCase()}.</div>
                  )}
                  {job.error ? <div className="mt-1 text-xs text-red-400">{String(job.error)}</div> : null}
                </div>
                {ACTIVE.has(status) && (
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
