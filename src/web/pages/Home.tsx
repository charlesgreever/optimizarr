import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatSize, type HomePayload } from "../api";
import { Help } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";

export function HomePage() {
  const [data, setData] = useState<HomePayload | null>(null);
  useEffect(() => {
    void api.home().then(setData);
  }, []);
  if (!data) return <p className="text-slate-400">Loading dashboard…</p>;
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Home</h1>
        <RefreshLibrary onDone={() => void api.home().then(setData)} />
      </div>
      <Help>
        Home is the landing page after sign-in. Files optimized and space saved only count after you Keep a sidecar. A sidecar is the new file waiting in Review; Keep replaces the library file with it.
      </Help>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Files optimized" value={String(data.filesOptimized)} />
        <Stat label="Space saved" value={formatSize(data.spaceSavedBytes)} />
        <Stat label="Status" value={data.status} />
        <Stat label="Suggestions" value={String(data.suggestions)} to="/suggestions" />
        <Stat label="Queue" value={String(data.queued)} to="/queue" />
        <Stat label="Review" value={String(data.review)} to="/review" />
        <Stat label="Errors" value={String(data.errors)} to="/errors" />
      </div>
      {data.filesOptimized === 0 && data.suggestions === 0 && (
        <div className="glass mt-6 p-5 text-sm text-slate-300">
          Nothing has been kept yet. Refresh the library to pull titles, then work Suggestions and Review.
        </div>
      )}
      <h2 className="mt-8 text-lg font-semibold">Recent activity</h2>
      <ul className="mt-3 space-y-2">
        {data.recent.map((row) => (
          <li key={row.id} className="glass px-4 py-3 text-sm">
            {row.displayTitle} · {row.outcome}
            {row.bytesSaved ? ` · saved ${formatSize(row.bytesSaved)}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, to }: { label: string; value: string; to?: string }) {
  const inner = (
    <div className="glass p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}
