import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type JobRow } from "../api";
import { PagedListControls } from "../components/PagedListControls";
import { Help, PageHead } from "../components/Shell";
import { usePagedList } from "../use-paged-list";

export function QueuePage() {
  const list = usePagedList({ loadPage: api.jobs, keyOf: (row: JobRow) => row.id, pollMs: 1000 });
  const items = list.items;
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const active = items.filter((job) => job.status === "queued" || job.status === "held" || job.status === "running" || job.status === "paused");
  const finished = items.filter((job) => job.status === "succeeded" || job.status === "failed" || job.status === "cancelled");
  const waitingIds = items.filter((job) => job.status === "queued" || job.status === "held" || job.status === "paused").map((job) => job.id);

  async function moveJob(id: string, delta: number) {
    const index = waitingIds.indexOf(id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= waitingIds.length) return;
    const ids = [...waitingIds];
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(next, 0, moved);
    await mutate(() => api.reorderJobs(ids));
  }

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
      <Help>Queue is approved work that has not finished. Open a title for the same media page as Movies and Series. Progress during a remux or transcode is elapsed media time, updated about once a second. Pause, resume, and reorder waiting jobs. Cancel never replaces the library file. Sidecar waits in Review; direct write replaces the library file after an integrity check.</Help>
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
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Phase</th>
                <th>Progress</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((job) => (
                <tr key={job.id}>
                  <td className="min-w-44">
                    {job.href ? (
                      <Link className="font-medium text-ink hover:text-accent" to={job.href}>
                        {job.displayTitle}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">{job.displayTitle}</span>
                    )}
                  </td>
                  <td>{job.status}</td>
                  <td>{planLabel(job)}</td>
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
                    {(job.status === "queued" || job.status === "held") && (
                      <button className="btn-secondary ml-1" type="button" onClick={() => void mutate(() => api.pauseJob(job.id))}>
                        Pause
                      </button>
                    )}
                    {job.status === "paused" && (
                      <button className="btn ml-1" type="button" onClick={() => void mutate(() => api.resumeJob(job.id))}>
                        Resume
                      </button>
                    )}
                    {(job.status === "queued" || job.status === "held" || job.status === "paused") && (
                      <>
                        <button className="btn-secondary ml-1" type="button" disabled={waitingIds.indexOf(job.id) <= 0} onClick={() => void moveJob(job.id, -1)}>
                          Up
                        </button>
                        <button className="btn-secondary ml-1" type="button" disabled={waitingIds.indexOf(job.id) === waitingIds.length - 1} onClick={() => void moveJob(job.id, 1)}>
                          Down
                        </button>
                      </>
                    )}
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
                    <button className="btn-secondary ml-1" type="button" onClick={() => void api.jobLogs(job.id).then((result) => setLogs((current) => ({ ...current, [job.id]: result.log || "(empty)" })))}>
                      Logs
                    </button>
                    {(job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") && (
                      <button className="btn-secondary ml-1" type="button" disabled={busy} onClick={() => void mutate(() => api.removeJob(job.id))}>
                        Remove
                      </button>
                    )}
                    {job.error && <div className="text-xs text-rose-400">{job.error}</div>}
                    {job.warning && <div className="text-xs text-amber-300">{job.warning}</div>}
                    {job.promoteError && <div className="text-xs text-amber-300">{job.promoteError}</div>}
                    {logs[job.id] != null && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-400">{logs[job.id]}</pre>}
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

function planLabel(job: JobRow): string {
  const mode = job.plan?.video?.kind;
  const write = job.writeMode ?? job.plan?.writeMode ?? "sidecar";
  const aim = mode === "size" ? "target size" : mode === "quality" ? "encoder quality" : "copy / remux";
  return `${aim} · ${write === "direct" ? "direct write" : "sidecar"}`;
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
