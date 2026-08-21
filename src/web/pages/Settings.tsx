import { useEffect, useState } from "react";
import { api, type FirstRun, type Hardware, type SettingsPayload } from "../api";
import { Help, PageHead } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";

export function SettingsPage({ firstRun, onChange }: { firstRun: FirstRun; onChange: () => void }) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [hw, setHw] = useState<Hardware | null>(null);
  const [msg, setMsg] = useState("");
  const [inst, setInst] = useState({ kind: "radarr", name: "", url: "", apiKey: "" });
  const [githubToken, setGithubToken] = useState("");

  const load = () => void api.settings().then(setData);
  useEffect(() => {
    load();
    void api.hardware().then(setHw);
  }, []);

  if (!data) return <p>Loading settings…</p>;

  return (
    <section className="max-w-3xl space-y-6">
      <div>
        <PageHead title="Settings" />
        <Help>
          Preferred language decides which audio and subtitle tracks stay. Confirm it once before any optimize. The review folder is where sidecars land; it must sit outside your movie and show libraries.
        </Help>
      </div>
      {!firstRun.complete && (
        <div className="glass border-amber-400/30 p-4 text-sm">
          First-run is incomplete.
          {!firstRun.languageConfirmed && " Confirm a preferred language."}
          {!firstRun.hasReviewPath && " Set a review folder."}
          {!firstRun.hasArr && " Connect an enabled Radarr or Sonarr."}
        </div>
      )}
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Language and review</h2>
        <label className="block text-sm">
          Preferred language
          <input className="ml-2" value={data.preferredLanguage} onChange={(e) => setData({ ...data, preferredLanguage: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.languageConfirmed} onChange={(e) => setData({ ...data, languageConfirmed: e.target.checked })} />
          I confirm this language before any track cleanup
        </label>
        <label className="block text-sm">
          Review folder
          <input className="mt-1 w-full" value={data.reviewPath} onChange={(e) => setData({ ...data, reviewPath: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.localAuthBypass} onChange={(e) => setData({ ...data, localAuthBypass: e.target.checked })} />
          Allow local addresses without a password
        </label>
        <label className="block text-sm">
          Write finished files
          <select className="ml-2" value={data.writeMode ?? "sidecar"} onChange={(e) => setData({ ...data, writeMode: e.target.value as "sidecar" | "direct" })}>
            <option value="sidecar">Sidecar for Review (default)</option>
            <option value="direct">Direct write after integrity check</option>
          </select>
        </label>
        <p className="help">Direct write replaces the library file only after the new file passes an integrity check. Arr refresh failures stay as a warning.</p>
        <label className="block text-sm">
          GitHub token for Report
          <input
            className="mt-1 w-full"
            type="password"
            autoComplete="off"
            value={githubToken}
            placeholder={data.hasGithubToken ? "Token saved. Paste a new one to replace it." : "Optional personal access token"}
            onChange={(e) => setGithubToken(e.target.value)}
          />
        </label>
        <p className="help">
          Optional. Report uploads the screenshot to GitHub and puts it on the new issue so it does not download to this computer.
          Use a classic token with the public_repo scope, or a fine-grained token that can write issues on charlesgreever/optimizarr.
          Without a token, Report copies the screenshot if the browser allows it, then downloads a PNG if copy fails.
        </p>
        {data.hasGithubToken && (
          <button
            className="btn-secondary"
            type="button"
            onClick={() =>
              void api.saveSettings({ ...data, githubToken: "" }).then(() => {
                setGithubToken("");
                load();
                setMsg("GitHub token removed.");
                onChange();
              })
            }
          >
            Remove GitHub token
          </button>
        )}
        <button
          className="btn"
          type="button"
          onClick={() => {
            const body: Record<string, unknown> = { ...data };
            if (githubToken.trim()) body.githubToken = githubToken.trim();
            void api.saveSettings(body).then(() => {
              setGithubToken("");
              load();
              setMsg("Settings saved.");
              onChange();
            });
          }}
        >
          Save settings
        </button>
      </div>
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Size caps (GB per hour)</h2>
        {Object.entries(data.sizeCaps).map(([key, value]) => (
          <label key={key} className="mr-4 text-sm">
            {key}
            <input className="ml-2 w-20" type="number" step="0.1" value={value} onChange={(e) => setData({ ...data, sizeCaps: { ...data.sizeCaps, [key]: Number(e.target.value) } })} />
          </label>
        ))}
        <div className="space-y-1 text-sm">
          {(data.profilePreviews ?? []).map((p) => (
            <div key={p.category}>{p.name}: {p.gbPerHour.toFixed(2)} GB/hr · {p.mbPerMin.toFixed(1)} MB/min</div>
          ))}
        </div>
        <button className="btn" type="button" onClick={() => void api.syncProfiles().then((r) => setMsg(r.results.map((x) => `${x.created.length} created, ${x.updated.length} updated`).join(" · ") || "Profiles synced.")).catch((e: Error) => setMsg(e.message))}>
          Sync quality profiles
        </button>
        <p className="help">Keep looks for a profile that does not upgrade, or creates the Optimizarr-named one if needed. Sync can create those profiles ahead of time. It never starts a search.</p>
      </div>
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Encode</h2>
        <p className="help">Detected hardware: {hw ? `${hw.backend}${hw.av1 ? ", AV1 encoder listed" : ", AV1 encoder not listed"}` : "checking…"}</p>
        <label className="block text-sm">
          Target
          <select className="ml-2" value={data.videoTarget} onChange={(e) => setData({ ...data, videoTarget: e.target.value })}>
            <option value="hevc">HEVC</option>
            <option value="av1">AV1</option>
          </select>
        </label>
        <label className="block text-sm">
          Concurrent jobs
          <input className="ml-2 w-16" type="number" min={1} value={data.concurrency} onChange={(e) => setData({ ...data, concurrency: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.conservativeMode} onChange={(e) => setData({ ...data, conservativeMode: e.target.checked })} />
          Conservative performance mode (does not change job count)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.offPeakEnabled} onChange={(e) => setData({ ...data, offPeakEnabled: e.target.checked })} />
          Hold jobs outside off-peak
        </label>
        <div className="text-sm">
          <input value={data.offPeakStart} onChange={(e) => setData({ ...data, offPeakStart: e.target.value })} />
          <span className="mx-2">to</span>
          <input value={data.offPeakEnd} onChange={(e) => setData({ ...data, offPeakEnd: e.target.value })} />
        </div>
      </div>
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Connections</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={inst.kind} onChange={(e) => setInst({ ...inst, kind: e.target.value })}>
            <option value="radarr">Radarr</option>
            <option value="sonarr">Sonarr</option>
            <option value="plex">Plex</option>
            <option value="jellyfin">Jellyfin</option>
          </select>
          <input placeholder="Name" value={inst.name} onChange={(e) => setInst({ ...inst, name: e.target.value })} />
          <input placeholder="URL" value={inst.url} onChange={(e) => setInst({ ...inst, url: e.target.value })} />
          <input placeholder="API key or token" value={inst.apiKey} onChange={(e) => setInst({ ...inst, apiKey: e.target.value })} />
        </div>
        <button
          className="btn"
          type="button"
          onClick={() =>
            void api
              .saveInstance(inst)
              .then(async () => {
                setInst({ ...inst, name: "", url: "", apiKey: "" });
                load();
                onChange();
                if (inst.kind === "radarr" || inst.kind === "sonarr") {
                  const result = await api.refresh();
                  setMsg(result.errors.length ? result.errors.join(" ") : `${inst.name} saved. Library lists updated.`);
                }
              })
              .catch((e: Error) => setMsg(e.message))
          }
        >
          Save connection
        </button>
        <ul className="space-y-2 text-sm">
          {data.instances.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2">
              <span>
                {row.name} · {row.kind} · {row.url} · {row.hasApiKey || row.hasToken ? "key saved" : "no key"}
              </span>
              <span className="flex gap-2">
                <button className="btn-secondary" type="button" onClick={() => void api.testInstance(row.id).then((r) => setMsg(r.ok ? `${row.name} is reachable.` : r.message || "Test failed."))}>
                  Test
                </button>
                <button className="btn-secondary danger" type="button" onClick={() => void api.deleteInstance(row.id).then(load)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        <RefreshLibrary />
      </div>
      {msg && <p className="ok text-sm">{msg}</p>}
    </section>
  );
}
