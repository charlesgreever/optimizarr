import { useEffect, useState } from "react";
import { api, type InspectProgress } from "../api";

export function InspectBanner() {
  const [progress, setProgress] = useState<InspectProgress | null>(null);

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

  if (!progress || (!progress.walking && progress.pending === 0)) return null;
  const total = progress.pending + progress.inspected;
  return (
    <div className="mb-5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
      Library loaded. Probing {progress.inspected} / {total} files.
      {progress.errors > 0 ? ` ${progress.errors} failed.` : ""}
    </div>
  );
}
