import { useEffect, useState } from "react";
import { api, formatSize, type HistoryRow } from "../api";
import { Help } from "../components/Shell";

export function HistoryPage() {
  const [items, setItems] = useState<HistoryRow[]>([]);
  useEffect(() => {
    void api.history().then((r) => setItems(r.items));
  }, []);
  return (
    <section>
      <h1 className="text-2xl font-semibold">History</h1>
      <Help>History is the log of finished work: kept, discarded, flagged, failed, and cancelled.</Help>
      {items.length === 0 ? (
        <div className="glass mt-6 p-5 text-sm text-slate-300">No finished work yet.</div>
      ) : (
        <div className="glass mt-5 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Title</th>
                <th>Outcome</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>{row.displayTitle}</td>
                  <td>{row.outcome}</td>
                  <td>{row.bytesSaved ? formatSize(row.bytesSaved) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
