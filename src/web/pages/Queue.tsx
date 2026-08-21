import { useState } from "react";
import { api, type JobRow } from "../api";
import { PagedListControls } from "../components/PagedListControls";
import { Help, PageHead } from "../components/Shell";
import { usePagedList } from "../use-paged-list";

export function QueuePage() {
  const list = usePagedList({ loadPage: api.jobs, keyOf: (row: JobRow) => row.id, pollMs: 1000 });
  const items = list.items;
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = items.filter((job) => job.status === "queued" || job.status === "held" || job.status === "running" || job.status === "paused");
  const finished = items.filter((job) => job.status === "succeeded" || job.status === "failed" || job.status === "cancelled");

  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    setMutationError("");
    try {
      await action();
      await list.reload();
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : "Queue could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHead title="Queue" />
      <Help>Queue is approved work that has not finished. Progress during a remux or transcode is elapsed media time, updated about once a second. Cancel never replaces the library file.</Help>
      <div className="mt-3 flex flex-wrap gap-2">
        {active.length > 0 && (
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => void mutate(api.cancelAll)}>
            Cancel all
          </button>
        )}
        {finished.length > 0 && (
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => void mutate(api.clearFinishedJobs)}>
            Clear finished
          </button>
        )}
      </div>
      {mutationError && <p className="mt-3 text-sm text-rose-400">{mutationError}</p>}
      {items.length === 0 && list.loading && <div className="empty">Loading queue…</div>}
      {items.length === 0 && !list.loading && !list.error && <div className="empty">The queue is idle. Approve a suggestion to add work.</div>}
      {items.length > 0 && (
        <div className="glass mt-5 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Phase</th>
                <th>Progress</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((job) => (
                <tr key={job.id}>
                  <td>{job.displayTitle}</td>
                  <td>{job.status}</td>
                  <td>{phaseLabel(job.phase, job.status)}</td>
                  <td>
                    {job.status === "running" ? (
                      <div className="job-progress">
                        <div className="job-progress-bar" style={{ width: `${Math.max(1, Math.round(job.progress * 100))}%` }} />
                        <span>{Math.round(job.progress * 100)}%</span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {(job.status === "queued" || job.status === "held" || job.status === "running" || job.status === "paused") && (
                      <button className="btn-secondary" type="button" onClick={() => void api.cancel(job.id).then(list.reload)}>
                        Cancel
                      </button>
                    )}
                    {job.status === "held" && (
                      <button className="btn ml-1" type="button" onClick={() => void api.runNow(job.id).then(list.reload)}>
                        Run now
                      </button>
                    )}
                    {(job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") && (
                      <button className="btn-secondary ml-1" type="button" disabled={busy} onClick={() => void mutate(() => api.removeJob(job.id))}>
                        Remove
                      </button>
                    )}
                    {job.error && <div className="text-xs text-rose-400">{job.error}</div>}
                    {job.warning && <div className="text-xs text-amber-300">{job.warning}</div>}
                    {job.promoteError && <div className="text-xs text-amber-300">{job.promoteError}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PagedListControls loading={list.loading} error={list.error} nextOffset={list.nextOffset} noun="jobs" onLoadMore={list.loadMore} onRetry={list.reload} />
    </section>
  );
}

function phaseLabel(phase: string, status: string): string {
  if (status === "held") return "Waiting for the off-peak window";
  if (status === "queued") return "Waiting for a slot";
  if (phase === "muxing") return "Muxing tracks";
  if (phase === "creating_stereo") return "Creating stereo audio";
  if (phase === "transcoding") return "Transcoding video";
  if (phase === "finishing") return "Checking the finished file";
  return status;
}
