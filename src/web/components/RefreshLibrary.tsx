import { useState } from "react";
import { api } from "../api";

export function RefreshLibrary({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const result = await api.refresh();
      setMsg(result.errors.length ? result.errors.join(" ") : "Movie and series lists updated.");
      onDone?.();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn" type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Refreshing…" : "Refresh library"}
      </button>
      {msg && <p className="help m-0">{msg}</p>}
    </div>
  );
}
