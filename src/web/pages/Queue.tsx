import { useEffect, useState } from "react";
import { api, type JobRow } from "../api";
import { Help } from "../components/Shell";

export function QueuePage() {
  const [items, setItems] = useState<JobRow[]>([]);
  const load = () => void api.jobs().then((r) => setItems(r.items));
  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Queue</h1>
      <Help>Queue is approved work that has not finished. Phase names the real step. Cancel never replaces the library file.</Help>
      {items.length === 0 ? (
        <div className="glass mt-6 p-5 text-sm text-slate-300">The queue is idle. Approve a suggestion to add work.</div>
      ) : (
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
                  <td>{job.status === "running" ? `${Math.round(job.progress * 100)}%` : "—"}</td>
                  <td>
                    {(job.status === "queued" || job.status === "held" || job.status === "running" || job.status === "paused") && (
                      <button className="btn-secondary" type="button" onClick={() => void api.cancel(job.id).then(load)}>
                        Cancel
                      </button>
                    )}
                    {job.status === "held" && (
                      <button className="btn ml-1" type="button" onClick={() => void api.runNow(job.id).then(load)}>
                        Run now
                      </button>
                    )}
                    {job.error && <div className="text-xs text-rose-400">{job.error}</div>}
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

function phaseLabel(phase: string, status: string): string {
  if (status === "held") return "Waiting for the off-peak window";
  if (status === "queued") return "Waiting for a slot";
  if (phase === "muxing") return "Muxing tracks";
  if (phase === "creating_stereo") return "Creating stereo audio";
  if (phase === "transcoding") return "Transcoding video";
  if (phase === "finishing") return "Checking the finished file";
  return status;
}
