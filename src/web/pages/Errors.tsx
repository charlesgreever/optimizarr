import { useEffect, useState } from "react";
import { api, type FileError } from "../api";
import { Help } from "../components/Shell";

export function ErrorsPage() {
  const [items, setItems] = useState<FileError[]>([]);
  useEffect(() => {
    void api.errors().then((r) => setItems(r.items));
  }, []);
  return (
    <section>
      <h1 className="text-2xl font-semibold">Errors</h1>
      <Help>Each row is one file Optimizarr could not read or probe. The count is distinct files, not retry attempts.</Help>
      {items.length === 0 ? (
        <div className="glass mt-6 p-5 text-sm text-slate-300">No unread files. Nothing needs attention here.</div>
      ) : (
        <div className="glass mt-5 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>File</th>
                <th>Path</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.path}>
                  <td>{row.displayTitle}</td>
                  <td>{row.fileName}</td>
                  <td className="text-xs text-slate-400">{row.path}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
