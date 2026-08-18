import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatSize, type SuggestionRow } from "../api";
import { Help } from "../components/Shell";

export function SuggestionsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [items, setItems] = useState<SuggestionRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setParams(q ? { q } : {});
      void api.suggestions(q).then((r) => setItems(r.items));
    }, 280);
    return () => clearTimeout(t);
  }, [q, setParams]);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Suggestions</h1>
      <Help>
        Suggestions is the work list: only titles that still need something. Tracks-only means keep the video and clean languages. After size stays blank when the video will not shrink.
      </Help>
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suggestions" />
        <button
          className="btn"
          type="button"
          disabled={!Object.values(selected).some(Boolean)}
          onClick={() => {
            const ids = items.filter((i) => selected[i.id]).map((i) => i.id);
            void Promise.all(ids.map((id) => api.queue({ suggestionId: id }))).then(() => setMsg(`Queued ${ids.length}.`));
          }}
        >
          Add selected to queue
        </button>
      </div>
      {items.length === 0 ? (
        <div className="glass mt-6 p-5 text-sm text-slate-300">No open work. Healthy files stay off this list.</div>
      ) : (
        <div className="glass mt-5 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Title</th>
                <th>Why</th>
                <th>Now</th>
                <th>After</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input type="checkbox" checked={Boolean(selected[item.id])} onChange={(e) => setSelected((s) => ({ ...s, [item.id]: e.target.checked }))} />
                  </td>
                  <td>
                    {item.displayTitle}
                    <div className="text-xs text-slate-500">{item.instanceName}</div>
                  </td>
                  <td className="max-w-sm text-sm">{item.reasons.join(" ")}</td>
                  <td className="text-sm">
                    {item.now.codec} · {formatSize(item.now.sizeBytes)}
                    {item.now.sizePerHourGb != null ? ` · ${item.now.sizePerHourGb.toFixed(2)} GB/hr` : ""}
                  </td>
                  <td className="text-sm">
                    {item.after.codec ?? "—"}
                    {item.after.sizeBytes != null ? ` · ${formatSize(item.after.sizeBytes)}` : ""}
                    {item.after.sizePerHourGb != null ? ` · ${item.after.sizePerHourGb.toFixed(2)} GB/hr` : " · same video size"}
                    {item.estimatedSavingsBytes ? ` · save ${formatSize(item.estimatedSavingsBytes)}` : ""}
                  </td>
                  <td>
                    <button className="btn" type="button" onClick={() => void api.queue({ suggestionId: item.id }).then(() => setMsg("Added to queue."))}>
                      Queue
                    </button>
                    <button className="btn-secondary ml-1" type="button" onClick={() => void api.dismiss(item.id).then(() => setItems((cur) => cur.filter((x) => x.id !== item.id)))}>
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </section>
  );
}
