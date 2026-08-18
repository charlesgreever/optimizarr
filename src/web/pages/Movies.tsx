import { useEffect, useMemo, useState } from "react";
import { api, formatSize, type LibraryRow } from "../api";
import { Help } from "../components/Shell";
import { RowActions } from "../components/RowActions";

export function MoviesPage() {
  const [items, setItems] = useState<LibraryRow[]>([]);
  const [sort, setSort] = useState<"title" | "size" | "quality">("title");
  const [error, setError] = useState("");

  const load = () => void api.movies().then((r) => setItems(r.items)).catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    return [...items].sort((a, b) => {
      if (sort === "size") return b.sizeBytes - a.sizeBytes;
      if (sort === "quality") return a.quality.localeCompare(b.quality);
      return a.displayTitle.localeCompare(b.displayTitle);
    });
  }, [items, sort]);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Movies</h1>
      <Help>Each row is one movie from Radarr. The plan column is what Optimizarr would do. You can queue work here without opening Suggestions.</Help>
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      {rows.length === 0 ? (
        <div className="glass mt-6 p-5 text-sm text-slate-300">No movies yet. Connect Radarr in Settings and refresh the library.</div>
      ) : (
        <div className="glass mt-5 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Poster</th>
                <th onClick={() => setSort("title")}>Title</th>
                <th>Instance</th>
                <th onClick={() => setSort("quality")}>Quality</th>
                <th onClick={() => setSort("size")}>Size</th>
                <th>Plan</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} id={item.id}>
                  <td>
                    {item.hasPoster ? (
                      <img src={`/api/library/${item.id}/poster`} alt="" className="h-14 w-10 rounded-md object-cover" />
                    ) : (
                      <div className="h-14 w-10 rounded-md bg-white/10" />
                    )}
                  </td>
                  <td>{item.displayTitle}</td>
                  <td className="text-slate-400">{item.instanceName}</td>
                  <td>{item.quality || "—"}</td>
                  <td>{formatSize(item.sizeBytes)}</td>
                  <td className="max-w-xs text-sm text-slate-300">{item.error || item.reasons[0] || (item.inspected ? "Healthy" : "Waiting for inspect")}</td>
                  <td>
                    <RowActions item={item} onDone={load} />
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
