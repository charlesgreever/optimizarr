import { useEffect, useState } from "react";
import { api, type InspectProgress } from "../api";
import { startSerialPolling } from "../poll";

export function InspectBanner() {
  const [progress, setProgress] = useState<InspectProgress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const next = await api.inspectProgress();
        if (!stop) setProgress(next);
      } catch {
        if (!stop) setProgress(null);
      }
    }
    const stopPolling = startSerialPolling(tick, 1500);
    return () => {
      stop = true;
      stopPolling();
    };
  }, []);

  if (!progress) return null;

  if (progress.walking) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-300/15 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100 shadow-lg shadow-amber-950/10 backdrop-blur-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.65)]" />
        <span>
          Movie and series lists are ready. Still reading leftover files: {progress.inspected} checked,{" "}
          {progress.pending} left.
          {progress.errors > 0 ? ` ${progress.errors} files could not be read.` : ""}
        </span>
      </div>
    );
  }

  if (progress.errors > 0 && !dismissed) {
    return (
      <div className="panel mb-6 flex items-center justify-between gap-3 px-4 py-3 text-sm text-zinc-300">
        <span>
          {progress.errors} file{progress.errors === 1 ? "" : "s"} could not be read.
        </span>
        <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
