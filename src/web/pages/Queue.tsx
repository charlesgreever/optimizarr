import { useEffect, useState } from "react";
import { api } from "../api";
import { startSerialPolling } from "../poll";

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
    return startSerialPolling(
      () => load().catch((e: Error) => setMessage(e.message)),
      3000,
    );
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
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Processing</div>
          <h1 className="page-title">Queue</h1>
          <p className="page-description">Track each copy, remux, and encode from approval through completion.</p>
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {items.length === 0 ? (
        <div className="empty-panel text-sm text-zinc-400">
          {message || "Approved work will appear here."}
        </div>
      ) : (
        <ul className="space-y-3">
          {[...items]
            .sort((a, b) => {
              const rank = (status: string) =>
                status === "running" ? 0 : status === "queued" || status === "held" ? 1 : 2;
              return rank(String(a.status)) - rank(String(b.status)) || Number(b.id) - Number(a.id);
            })
            .map((job) => {
            const status = String(job.status ?? "");
            const waiting = WAITING.has(status);
            const showBar = status === "running" && !waiting;
            const pct = percent(job.progress);
            const eta = formatEta(job.etaSec);
            const label = job.phaseLabel || String(job.phase || status);
            return (
              <li
                key={String(job.id)}
                className="panel flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-sm transition hover:border-white/[0.12]"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold tracking-[-0.01em]">{String(job.displayTitle || job.title || "Job")}</div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</div>
                  {showBar && pct != null && (
                    <div className="mt-2 max-w-md">
                      <div className="h-2 overflow-hidden rounded-full border border-white/[0.04] bg-black/30">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.25)]" style={{ width: `${pct}%` }} />
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
                    className="btn-secondary"
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
