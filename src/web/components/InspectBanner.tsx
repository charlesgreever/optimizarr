import { useEffect, useState } from "react";
import { api, type InspectProgress } from "../api";

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
    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  if (!progress) return null;

  if (progress.walking) {
    return (
      <div className="mb-5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        Movie and series lists are ready. Still reading leftover files: {progress.inspected} checked,{" "}
        {progress.pending} left.
        {progress.errors > 0 ? ` ${progress.errors} files could not be read.` : ""}
      </div>
    );
  }

  if (progress.errors > 0 && !dismissed) {
    return (
      <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
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
