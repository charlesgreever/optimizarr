import { Link } from "react-router-dom";
import { useState } from "react";
import { api, type LibraryRow } from "../api";
import { Icons } from "./icons";

const iconBtn =
  "inline-flex h-11 w-11 items-center justify-center rounded border border-ink/15 bg-white text-ink transition-colors hover:border-accent hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";
const queueBtn =
  "inline-flex h-11 items-center justify-center gap-1 rounded border border-accent bg-accent px-2.5 text-xs font-semibold text-canvas transition-colors hover:bg-ink hover:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40";

export function RowActions({ item, onDone }: { item: LibraryRow; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  const locked = Boolean(item.error) || !item.inspected;
  const href = item.href || (item.type === "movie" ? `/movies/${item.id}` : `/series/episodes/${item.id}`);

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
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-nowrap items-center gap-1" role="group" aria-label="Title actions">
        <Link className={iconBtn} to={href} title="Open" aria-label="Open">
          {Icons.open({ width: 14, height: 14 })}
        </Link>
        <button
          className={queueBtn}
          type="button"
          disabled={locked || !item.suggestion}
          title="Queue"
          aria-label="Queue"
          onClick={() => void run("Added to queue.", () => api.queue({ itemId: item.id }))}
        >
          {Icons.queue({ width: 14, height: 14 })}
          Queue
        </button>
        <button
          className={iconBtn}
          type="button"
          disabled={locked}
          title="Force suggestion"
          aria-label="Force suggestion"
          onClick={() => void run("Added this title to Suggestions.", () => api.force(item.id))}
        >
          {Icons.suggestions({ width: 14, height: 14 })}
        </button>
        <button
          className={iconBtn}
          type="button"
          disabled={locked}
          title="Add stereo"
          aria-label="Add stereo"
          onClick={() => void run("Added stereo to the plan.", () => api.stereo(item.id))}
        >
          {Icons.stereo({ width: 14, height: 14 })}
        </button>
        <button
          className={`${iconBtn} ${item.sizeExempt ? "border-accent/40 bg-accent/15 text-accent" : ""}`}
          type="button"
          title={item.sizeExempt ? "Clear size exemption" : "Exempt size"}
          aria-label={item.sizeExempt ? "Clear size exemption" : "Exempt size"}
          aria-pressed={item.sizeExempt}
          onClick={() => void run(item.sizeExempt ? "Cleared exemption." : "Size cap exemption saved.", () => api.exempt(item.id, !item.sizeExempt))}
        >
          {Icons.exempt({ width: 14, height: 14 })}
        </button>
      </div>
      {msg && <p className="text-xs text-slate-400">{msg}</p>}
    </div>
  );
}
