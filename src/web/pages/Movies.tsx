import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatSize, type LibraryRow } from "../api";
import { Help, PageHead } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";
import { RowActions } from "../components/RowActions";

export function MoviesPage() {
  const [items, setItems] = useState<LibraryRow[]>([]);
  const [sort, setSort] = useState<"title" | "size" | "quality">("title");
  const [error, setError] = useState("");

  const load = () => void api.movies().then((r) => setItems(r.items)).catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
    void api.refresh().then(load).catch((e: Error) => {
      setError(e.message);
      load();
    });
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
      <PageHead title="Movies">
        <RefreshLibrary onDone={load} />
      </PageHead>
      <Help>Each row is one movie. Open a title for custom work. Queue still uses the automatic suggestion.</Help>
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
      {rows.length === 0 ? (
        <div className="empty">
          <div className="space-y-3">
            <p>No movies loaded yet. Refresh pulls titles from the Radarr connections in Settings.</p>
            <RefreshLibrary onDone={load} />
          </div>
        </div>
      ) : (
        <div className="glass mt-5 overflow-x-auto">
          <table className="dense">
            <thead>
              <tr>
                <th>Poster</th>
                <th onClick={() => setSort("title")}>Title</th>
                <th>Video</th>
                <th>Audio</th>
                <th>Subs</th>
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
                      <img src={`/api/library/${item.id}/poster`} alt="" className="h-10 w-7 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-7 rounded bg-white/10" />
                    )}
                  </td>
                  <td>
                    <Link to={item.href || `/movies/${item.id}`}>{item.displayTitle}</Link>
                    <div className="text-xs text-slate-400">{item.instanceName}</div>
                  </td>
                  <td className="text-sm">{item.videoLabel || "—"}</td>
                  <td className="max-w-40 truncate text-sm">{item.audioLabels?.join(", ") || "—"}</td>
                  <td className="max-w-32 truncate text-sm">{item.subtitleLabels?.join(", ") || "—"}</td>
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
