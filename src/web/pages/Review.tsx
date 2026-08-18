import { useEffect, useState } from "react";
import { api } from "../api";
import {
  keepSelected,
  pendingReviewIds,
  selectedPendingReviewIds,
  type SelectableReviewStatus,
} from "../keep-selected";

type ReviewRow = {
  id: number;
  title: string;
  displayTitle?: string;
  sourcePath: string;
  sidecarPath: string;
  status?: SelectableReviewStatus;
  phase?: string | null;
  phaseLabel?: string | null;
  progress?: number;
  error?: string | null;
  compare: { source?: { size?: number; duration?: number; codec?: string }; sidecar?: { size?: number; duration?: number } };
};

export function Review() {
  const [items, setItems] = useState<ReviewRow[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: number; kind: "keep" | "discard" } | null>(null);
  const [bulkAction, setBulkAction] = useState<"selected" | "all" | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkErrors, setBulkErrors] = useState<Record<number, string>>({});

  async function load() {
    const data = await api.review();
    setItems(data.items as ReviewRow[]);
    setMessage(data.message || "");
  }

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  const hasActive = items.some((item) => item.status === "keeping");
  const selectedIds = selectedPendingReviewIds(items, selected);
  const pendingIds = pendingReviewIds(items);
  const bulkBusy = bulkAction !== null;
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      void load().catch(() => {
        // A background poll must not replace a Keep error the operator already sees.
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  async function startKeeps(reviewIds: number[], action: "selected" | "all") {
    if (reviewIds.length === 0) return;
    setBulkAction(action);
    setError(null);
    setBulkStatus(null);
    setBulkErrors({});
    try {
      const result = await keepSelected(reviewIds, api.keepReview);
      const accepted = `${result.acceptedIds.length} Keep${result.acceptedIds.length === 1 ? " was" : "s were"} accepted.`;
      const skipped = result.failures.length ? ` ${result.failures.length} could not be started.` : "";
      setBulkStatus(`${accepted}${skipped}`);
      setBulkErrors(Object.fromEntries(result.failures.map((failure) => [failure.reviewId, failure.error])));
      setSelected({});
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the Keeps.");
    } finally {
      setBulkAction(null);
    }
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <div className="page-eyebrow">Decision point</div>
          <h1 className="page-title">Review</h1>
          <p className="page-description">Compare the original with its sidecar. The library changes only after you choose Keep.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            type="button"
            disabled={bulkBusy || selectedIds.length === 0}
            onClick={() => void startKeeps(selectedIds, "selected")}
          >
            {bulkAction === "selected" ? "Starting Keeps…" : `Keep selected (${selectedIds.length})`}
          </button>
          <button
            className="btn !w-auto"
            type="button"
            disabled={bulkBusy || pendingIds.length === 0}
            onClick={() => void startKeeps(pendingIds, "all")}
          >
            {bulkAction === "all" ? "Starting Keeps…" : `Keep all (${pendingIds.length})`}
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {bulkStatus && <p className="mt-3 text-sm text-emerald-400">{bulkStatus}</p>}
      {items.length === 0 ? (
        <div className="empty-panel text-sm text-zinc-400">
          {message || "Finished sidecars wait here for Keep or Discard."}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="panel overflow-hidden p-5 md:p-6">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={item.status !== "keeping" && Boolean(selected[item.id])}
                  disabled={item.status === "keeping" || bulkBusy}
                  onChange={(event) =>
                    setSelected((current) => ({ ...current, [item.id]: event.target.checked }))
                  }
                />
                <h2 className="text-lg font-semibold tracking-[-0.02em]">{item.displayTitle || item.title}</h2>
              </label>
              <div className="mt-3 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-4">
                  <div className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-zinc-500">Original</div>
                  <div>codec {item.compare.source?.codec ?? "—"}</div>
                  <div>size {item.compare.source?.size ?? "—"}</div>
                  <div className="truncate">{item.sourcePath}</div>
                </div>
                <div className="rounded-xl border border-amber-300/10 bg-amber-400/[0.035] p-4">
                  <div className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-amber-300/70">Optimized sidecar</div>
                  <div>duration {item.compare.sidecar?.duration ?? "—"}s</div>
                  <div>size {item.compare.sidecar?.size ?? "—"}</div>
                  <div className="truncate">{item.sidecarPath}</div>
                </div>
              </div>
              {(item.status === "keeping" || item.phaseLabel) && (
                <p className="mt-3 text-sm text-amber-300">
                  {item.phaseLabel || "Moving the sidecar onto the library file"}
                  {item.status === "keeping" && item.phase === "copying" && item.progress
                    ? ` · ${Math.round(Math.min(1, item.progress) * 100)}%`
                    : ""}
                </p>
              )}
              {(bulkErrors[item.id] || item.error) && (
                <p className="mt-2 text-sm text-red-400">{bulkErrors[item.id] || item.error}</p>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  className="btn !w-auto"
                  type="button"
                  disabled={bulkBusy || busy?.id === item.id || item.status === "keeping"}
                  onClick={() => {
                    void (async () => {
                      setBusy({ id: item.id, kind: "keep" });
                      setError(null);
                      try {
                        await api.keepReview(item.id);
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Could not keep this sidecar.");
                      } finally {
                        setBusy(null);
                      }
                    })();
                  }}
                >
                  {item.status === "keeping" || (busy?.id === item.id && busy.kind === "keep") ? "Keeping…" : "Keep"}
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={bulkBusy || busy?.id === item.id || item.status === "keeping"}
                  onClick={() => {
                    void (async () => {
                      setBusy({ id: item.id, kind: "discard" });
                      setError(null);
                      try {
                        await api.discardReview(item.id);
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Could not discard this sidecar.");
                      } finally {
                        setBusy(null);
                      }
                    })();
                  }}
                >
                  {busy?.id === item.id && busy.kind === "discard" ? "Discarding…" : "Discard"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
