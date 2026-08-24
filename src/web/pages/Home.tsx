import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatSize, type HomePayload } from "../api";
import { Help, PageHead } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";

export function HomePage() {
  const [data, setData] = useState<HomePayload | null>(null);
  useEffect(() => {
    void api.home().then(setData);
  }, []);
  if (!data) return <p className="help">Loading dashboard…</p>;
  return (
    <section>
      <PageHead title="Home">
        <RefreshLibrary onDone={() => void api.home().then(setData)} />
      </PageHead>
      <Help>
        Home is the landing page after sign-in. Files optimized and space saved count after you Keep a sidecar or after a successful direct write. Status is the running title, how many jobs are waiting, or Idle. A sidecar is the new file waiting in Review; Keep replaces the library file with it.
      </Help>
      <div className="metrics">
        <Stat label="Files optimized" value={String(data.filesOptimized)} />
        <Stat label="Space saved" value={formatSize(data.spaceSavedBytes)} />
        <Stat label="Status" value={data.status} />
        <Stat label="Suggestions" value={String(data.suggestions)} to="/suggestions" />
        <Stat label="Queue" value={String(data.queued)} to="/queue" />
        <Stat label="Review" value={String(data.review)} to="/review" />
        <Stat label="Errors" value={String(data.errors)} to="/errors" />
      </div>
      {data.filesOptimized === 0 && data.suggestions === 0 && (
        <div className="empty">
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
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );
  return <article>{to ? <Link to={to}>{body}</Link> : body}</article>;
}
