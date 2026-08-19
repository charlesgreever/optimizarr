import { Link } from "react-router-dom";
import { useState } from "react";
import { api, type LibraryRow } from "../api";
import { Icons } from "./icons";

export function RowActions({ item, onDone }: { item: LibraryRow; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const locked = Boolean(item.error) || !item.inspected;

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      setMsg(label);
      onDone();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "The action failed.");
    }
  }

  return (
    <div className="flex flex-wrap gap-1">
      <Link className="btn-secondary" to={item.href || (item.type === "movie" ? `/movies/${item.id}` : `/series/episodes/${item.id}`)}>
        Open
      </Link>
      <button className="btn-secondary" type="button" disabled={locked || !item.suggestion} onClick={() => void run("Added to queue.", () => api.queue({ itemId: item.id }))}>
        {Icons.queue()} Queue
      </button>
      <button className="btn-secondary" type="button" disabled={locked} onClick={() => void run("Added this title to Suggestions.", () => api.force(item.id))}>
        {Icons.suggestions()} Force
      </button>
      <button className="btn-secondary" type="button" disabled={locked} onClick={() => void run("Added stereo to the plan.", () => api.stereo(item.id))}>
        {Icons.stereo()} Stereo
      </button>
      <button className="btn-secondary" type="button" onClick={() => void run(item.sizeExempt ? "Cleared exemption." : "Size cap exemption saved.", () => api.exempt(item.id, !item.sizeExempt))}>
        {Icons.exempt()} {item.sizeExempt ? "Clear exemption" : "Exempt size"}
      </button>
      {msg && <p className="w-full text-xs text-slate-400">{msg}</p>}
    </div>
  );
}
