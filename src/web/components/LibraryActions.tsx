import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type Props = {
  itemId: number;
  readable: boolean;
  pathError: string | null;
  titleQuery?: string;
};

export function LibraryActions({ itemId, readable, pathError, titleQuery }: Props) {
  const [busy, setBusy] = useState<"force" | "stereo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function run(kind: "force" | "stereo") {
    setError(null);
    setStatus(null);
    if (!readable) {
      setError(pathError || "This file is not readable yet.");
      return;
    }
    setBusy(kind);
    try {
      const result = kind === "force" ? await api.forceItem(itemId) : await api.addStereo(itemId);
      if (!result.onSuggestions) {
        setError("No suggestion was created.");
        return;
      }
      setStatus(kind === "force" ? "Added this title to Suggestions." : "Added a stereo AAC track to the suggestion.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the suggestion.");
    } finally {
      setBusy(null);
    }
  }

  const suggestionsTo = titleQuery
    ? `/suggestions?q=${encodeURIComponent(titleQuery)}`
    : "/suggestions";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.055] pt-2.5">
      <button
        className="text-xs font-medium text-amber-400 transition hover:text-amber-300 disabled:opacity-50"
        type="button"
        disabled={busy !== null || !readable}
        onClick={() => void run("force")}
      >
        {busy === "force" ? "Forcing…" : "Force suggestion"}
      </button>
      <button
        className="text-xs font-medium text-amber-400 transition hover:text-amber-300 disabled:opacity-50"
        type="button"
        disabled={busy !== null || !readable}
        onClick={() => void run("stereo")}
      >
        {busy === "stereo" ? "Adding…" : "Add stereo"}
      </button>
      {status && (
        <div className="basis-full text-xs text-emerald-400">
          {status}{" "}
          <Link to={suggestionsTo} className="underline hover:text-emerald-300">
            Open Suggestions
          </Link>
        </div>
      )}
      {error && <div className="basis-full text-xs text-red-400">{error}</div>}
    </div>
  );
}
