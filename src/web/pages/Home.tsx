import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatSize, type HistoryRow, type HomePayload } from "../api";
import { Card } from "../components/Card";
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
      <Card>
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Status</div>
        <p className="mt-1 font-mono text-sm font-medium leading-6 text-ink">{data.status}</p>
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Files optimized</div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink">{data.filesOptimized}</p>
        </Card>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Space saved</div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-ink">{formatSize(data.spaceSavedBytes)}</p>
        </Card>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
      <Card title="Recent activity" padded={data.recent.length === 0}>
        {data.recent.length === 0 ? (
          <p className="help m-0">No finished work yet.</p>
        ) : (
          <table className="dense">
            <thead>
              <tr>
                <th>Title</th>
                <th>Outcome</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-ink">{row.displayTitle}</td>
                  <td><Pill tone={activityTone(row.outcome)}>{activityOutcomeLabel(row.outcome)}</Pill></td>
                  <td className="font-mono text-sm text-muted">{row.bytesSaved ? formatSize(row.bytesSaved) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
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
    <Link to={to} className="block rounded-2xl border border-ink/10 bg-white px-5 py-5 hover:border-accent">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 font-mono text-xl font-medium tabular-nums text-ink">{value}</div>
    </Link>
  );
}
