import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Poster } from "../components/Poster";
import { formatSize } from "../format";

type Row = {
  id: number;
  itemId: number;
  title: string;
  displayTitle?: string;
  seriesTitle?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  actions: string[];
  warning: string | null;
  estimatedSavingsBytes: number | null;
  overCap: boolean;
  extraTracks: boolean;
  category: string;
  sizePerHourGb: number | null;
  videoCodec: string | null;
  instanceName: string;
  hasPoster?: boolean;
  quality?: string | null;
  size?: number | null;
  reasons?: string[];
  now?: { codec: string | null; sizeBytes: number | null; sizePerHourGb: number | null; quality?: string | null };
  after?: { codec: string | null; sizeBytes: number | null; sizePerHourGb: number | null; quality?: string | null };
};

function savings(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function Suggestions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qParam = searchParams.get("q") ?? "";
  const [items, setItems] = useState<Row[]>([]);
  const [q, setQ] = useState(qParam);
  const [overCap, setOverCap] = useState(false);
  const [extraTracks, setExtraTracks] = useState(false);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | "all" | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setQ(qParam);
  }, [qParam]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (q !== qParam) setSearchParams(q ? { q } : {}, { replace: true });
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (overCap) params.set("overCap", "1");
      if (extraTracks) params.set("extraTracks", "1");
      void api
        .suggestions(params, controller.signal)
        .then((data) => {
          setItems((data.items as Row[]) ?? []);
          setMessage(data.message || "");
        })
        .catch((e: unknown) => {
          if (!isAbort(e)) setError(e instanceof Error ? e.message : "Search failed");
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, qParam, overCap, extraTracks, setSearchParams]);

  async function queueOne(id: number) {
    setBusyId(id);
    setError(null);
    setStatus(null);
    try {
      await api.enqueue(id);
      setStatus("Added to the queue.");
      setSelected((s) => ({ ...s, [id]: false }));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add to the queue");
    } finally {
      setBusyId(null);
    }
  }

  async function queueMany(ids: number[]) {
    if (ids.length === 0) return;
    setBusyId("all");
    setError(null);
    setStatus(null);
    const failed: string[] = [];
    let ok = 0;
    for (const id of ids) {
      try {
        await api.enqueue(id);
        ok += 1;
      } catch (e) {
        failed.push(e instanceof Error ? e.message : "failed");
      }
    }
    setStatus(ok ? `Added ${ok} item${ok === 1 ? "" : "s"} to the queue.` : null);
    if (failed.length) setError(failed[0]);
    setSelected({});
    await reload();
    setBusyId(null);
  }

  async function reload() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (overCap) params.set("overCap", "1");
    if (extraTracks) params.set("extraTracks", "1");
    const data = await api.suggestions(params);
    setItems((data.items as Row[]) ?? []);
    setMessage(data.message || "");
  }

  const selectedIds = items.filter((i) => selected[i.id]).map((i) => i.id);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suggestions</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Approve work here. Queued items run in{" "}
            <Link to="/queue" className="text-amber-400 hover:text-amber-300">
              Queue
            </Link>
            , then wait in{" "}
            <Link to="/review" className="text-amber-400 hover:text-amber-300">
              Review
            </Link>{" "}
            for Keep or Discard.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn !w-auto"
            type="button"
            disabled={busyId !== null || selectedIds.length === 0}
            onClick={() => void queueMany(selectedIds)}
          >
            {busyId === "all" ? "Queuing…" : `Add selected to queue${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
          </button>
          <button
            className="btn !w-auto !bg-zinc-700 !text-zinc-100"
            type="button"
            disabled={busyId !== null || items.length === 0}
            onClick={() => void queueMany(items.map((i) => i.id))}
          >
            Queue all visible
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search show, episode, or codec"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={overCap} onChange={(e) => setOverCap(e.target.checked)} />
          Over size cap
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={extraTracks} onChange={(e) => setExtraTracks(e.target.checked)} />
          Extra tracks
        </label>
        <button
          className="text-xs text-zinc-400 hover:text-zinc-200"
          type="button"
          onClick={() => setView((v) => (v === "cards" ? "list" : "cards"))}
        >
          {view === "cards" ? "Compact list" : "Cards"}
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {status && <p className="mt-4 text-sm text-emerald-400">{status}</p>}
      {items.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
          <p className="text-sm text-zinc-400">{message || "No suggestions."}</p>
        </div>
      ) : (
        <ul className={view === "cards" ? "mt-6 grid gap-3 sm:grid-cols-1 xl:grid-cols-2" : "mt-6 space-y-3"}>
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <label className="flex min-w-0 flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={Boolean(selected[item.id])}
                    onChange={(e) => setSelected((s) => ({ ...s, [item.id]: e.target.checked }))}
                  />
                  <Poster
                    itemId={item.itemId}
                    hasPoster={item.hasPoster}
                    alt=""
                    className="h-20 w-[3.35rem] rounded-md"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{item.displayTitle || item.title}</span>
                    <span className="block text-xs text-zinc-500">{item.instanceName}</span>
                    {item.reasons && item.reasons.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-sm text-zinc-300">
                        {item.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="mt-1 block text-sm text-zinc-300">
                        Plan: {item.actions.join(", ") || "none"}
                      </span>
                    )}
                    <div className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                      <div>
                        <div className="font-medium text-zinc-400">Now</div>
                        <div>
                          {item.now?.codec || item.videoCodec || "unknown codec"}
                          {item.now?.quality || item.quality ? ` · ${item.now?.quality || item.quality}` : ""}
                          {item.now?.sizeBytes || item.size ? ` · ${formatSize(item.now?.sizeBytes ?? item.size)}` : ""}
                          {item.now?.sizePerHourGb != null || item.sizePerHourGb
                            ? ` · ${(item.now?.sizePerHourGb ?? item.sizePerHourGb)?.toFixed(2)} GB/hr`
                            : ""}
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-zinc-400">After</div>
                        <div>
                          {item.after?.codec || "—"}
                          {item.after?.sizeBytes != null ? ` · ${formatSize(item.after.sizeBytes)}` : ""}
                          {item.after?.sizePerHourGb != null ? ` · ${item.after.sizePerHourGb.toFixed(2)} GB/hr` : ""}
                          {item.estimatedSavingsBytes ? ` · save ~${savings(item.estimatedSavingsBytes)}` : ""}
                        </div>
                      </div>
                    </div>
                    {item.warning && <span className="mt-1 block text-xs text-amber-400">{item.warning}</span>}
                  </span>
                </label>
                <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                  <button
                    className="btn !w-auto"
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void queueOne(item.id)}
                  >
                    {busyId === item.id ? "Adding…" : "Add to queue"}
                  </button>
                  <button
                    className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => {
                      void api
                        .dismissSuggestion(item.id)
                        .then(() => reload())
                        .catch((e: Error) => setError(e.message));
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
