import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatSize, type HistoryRow, type HomePayload } from "../api";
import { Help, PageHead } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";
import { Pill } from "../components/ui";

export function HomePage() {
  const [data, setData] = useState<HomePayload | null>(null);
  useEffect(() => {
    void api.home().then(setData);
  }, []);
  if (!data) return <p className="help">Loading dashboard…</p>;
  return <HomeDashboard data={data} onRefresh={() => void api.home().then(setData)} />;
}

export function HomeDashboard({ data, onRefresh }: { data: HomePayload; onRefresh?: () => void }) {
  const empty = data.filesOptimized === 0 && data.suggestions === 0 && data.recent.length === 0;
  return (
    <section className="space-y-5">
      <PageHead title="Home">
        <RefreshLibrary onDone={onRefresh} />
      </PageHead>
      <Help>
        Home is the landing page after sign-in. Files optimized and space saved count after you Keep a sidecar or after a successful direct write. Status is the running title, how many jobs are waiting, or Idle. A sidecar is the new file waiting in Review; Keep replaces the library file with it.
      </Help>
      <div className="glass px-5 py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Status</div>
        <p className="mt-1 font-mono text-sm font-medium leading-6 text-ink">{data.status}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <article className="glass px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Files optimized</div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink">{data.filesOptimized}</p>
        </article>
        <article className="glass px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Space saved</div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink">{formatSize(data.spaceSavedBytes)}</p>
        </article>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WorkStat label="Suggestions" value={data.suggestions} to="/suggestions" />
        <WorkStat label="Queue" value={data.queueActive ?? data.queued} to="/queue" />
        <WorkStat label="Review" value={data.review} to="/review" />
        <WorkStat label="Errors" value={data.errors} to="/errors" />
      </div>
      {empty && (
        <p className="help m-0">
          Nothing has been kept yet. Refresh the library to pull titles, then work Suggestions and Review.
        </p>
      )}
      <div>
        <h2 className="text-lg font-semibold text-ink">Recent activity</h2>
        {data.recent.length === 0 ? (
          <p className="help mt-3">No finished work yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.recent.map((row) => (
              <li key={row.id} className="glass flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="min-w-0 font-medium text-ink">{row.displayTitle}</span>
                <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
                  <Pill tone={activityTone(row.outcome)}>{activityOutcomeLabel(row.outcome)}</Pill>
                  {row.bytesSaved ? `saved ${formatSize(row.bytesSaved)}` : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function activityOutcomeLabel(outcome: HistoryRow["outcome"]): string {
  if (outcome === "kept") return "Kept";
  if (outcome === "discarded") return "Discarded";
  if (outcome === "flagged") return "Flagged";
  if (outcome === "failed") return "Failed";
  if (outcome === "searched") return "Asked to search";
  return "Cancelled";
}

function activityTone(outcome: HistoryRow["outcome"]): "good" | "warn" | "bad" | "neutral" {
  if (outcome === "kept") return "good";
  if (outcome === "flagged") return "warn";
  if (outcome === "failed") return "bad";
  return "neutral";
}

function WorkStat({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link
      to={to}
      className="glass block px-4 py-4 transition-colors hover:border-accent/40"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 font-mono text-xl font-medium tabular-nums text-ink">{value}</div>
    </Link>
  );
}
