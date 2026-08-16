import { useEffect, useState } from "react";
import { api } from "../api";

type Row = {
  id: number;
  itemId: number;
  title: string;
  actions: string[];
  warning: string | null;
  estimatedSavingsBytes: number | null;
  overCap: boolean;
  extraTracks: boolean;
  category: string;
  sizePerHourGb: number | null;
  videoCodec: string | null;
  instanceName: string;
};

function savings(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function Suggestions() {
  const [items, setItems] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [overCap, setOverCap] = useState(false);
  const [extraTracks, setExtraTracks] = useState(false);
  const [message, setMessage] = useState("");

  async function load(nextQ = q) {
    const params = new URLSearchParams();
    if (nextQ) params.set("q", nextQ);
    if (overCap) params.set("overCap", "1");
    if (extraTracks) params.set("extraTracks", "1");
    const data = await api.suggestions(params);
    setItems(data.items as Row[]);
    setMessage(data.message || "");
  }

  useEffect(() => {
    void load();
  }, [overCap, extraTracks]);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Suggestions</h1>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search title"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            void load(e.target.value);
          }}
        />
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={overCap} onChange={(e) => setOverCap(e.target.checked)} />
          Over size cap
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={extraTracks} onChange={(e) => setExtraTracks(e.target.checked)} />
          Extra tracks
        </label>
      </div>
      {items.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
          <p className="text-sm text-zinc-400">{message || "No suggestions."}</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">GB/hour</th>
                <th className="px-4 py-3">Est. save</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-zinc-800">
                  <td className="px-4 py-3">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-zinc-500">
                      {item.instanceName} · {item.videoCodec} · {item.category}
                    </div>
                    {item.warning && <div className="mt-1 text-xs text-amber-400">{item.warning}</div>}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{item.actions.join(", ")}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {item.sizePerHourGb ? item.sizePerHourGb.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{savings(item.estimatedSavingsBytes)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-1">
                      <button
                        className="text-xs text-amber-400 hover:text-amber-300"
                        type="button"
                        onClick={() => {
                          void api.enqueue(item.id).then(() => load());
                        }}
                      >
                        Queue
                      </button>
                      <button
                        className="text-xs text-zinc-400 hover:text-white"
                        type="button"
                        onClick={() => {
                          void api.dismissSuggestion(item.id).then(() => load());
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
