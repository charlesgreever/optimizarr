import { useEffect, useState } from "react";
import { api, type Exclusion, type FirstRun, type Hardware, type SettingsPayload } from "../api";
import { Help, PageHead } from "../components/Shell";
import { RefreshLibrary } from "../components/RefreshLibrary";
import { EncodeSettings } from "../components/EncodeSettings";
import { SuggestionDefaultsSettings } from "../components/SuggestionDefaultsSettings";

export function SettingsPage({ firstRun, onChange }: { firstRun: FirstRun; onChange: () => void }) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [hw, setHw] = useState<Hardware | null>(null);
  const [msg, setMsg] = useState("");
  const [inst, setInst] = useState<{ kind: "radarr" | "sonarr" | "plex" | "jellyfin"; name: string; url: string; apiKey: string }>({
    kind: "radarr",
    name: "",
    url: "",
    apiKey: "",
  });
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [exclusion, setExclusion] = useState<{ kind: Exclusion["kind"]; value: string }>({ kind: "path", value: "" });
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const load = () => void api.settings().then((payload) => {
    setData(payload);
    setUsername(payload.username ?? "");
  });
  useEffect(() => {
    load();
    void api.hardware().then(setHw);
    void api.exclusions().then((result) => setExclusions(result.exclusions));
  }, []);

  const save = () => {
    if (!data) return;
    void api.saveSettings(data).then(() => {
      setMsg("Settings saved.");
      onChange();
    });
  };

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
          <select className="ml-2" value={data.writeMode ?? "sidecar"} onChange={(e) => {
            const value = e.target.value;
            if (value === "sidecar" || value === "direct") setData({ ...data, writeMode: value });
          }}>
            <option value="sidecar">Sidecar for Review (default)</option>
            <option value="direct">Direct write after integrity check</option>
          </select>
        </label>
        <p className="help">Direct write replaces the library file only after the new file passes an integrity check. Arr refresh failures stay as a warning.</p>
        <button
          className="btn"
          type="button"
          onClick={save}
        >
          Save settings
        </button>
      </div>
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Account</h2>
        <p className="help">Change the sign-in name and password. Polisharr signs you in again after a password change.</p>
        <label className="block text-sm">
          Username
          <input className="mt-1 w-full" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="block text-sm">
          New password
          <input className="mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <button
          className="btn"
          type="button"
          disabled={!username.trim() || password.length < 8}
          onClick={() => void api.changePassword(username.trim(), password).then(() => {
            setPassword("");
            setMsg("Username and password saved.");
            onChange();
          }).catch((e: Error) => setMsg(e.message))}
        >
          Save username and password
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
        <SuggestionDefaultsSettings
          value={data.suggestionDefaults}
          onChange={(suggestionDefaults) => setData({ ...data, suggestionDefaults })}
          onSave={save}
        />
        <div className="space-y-1 text-sm">
          {(data.profilePreviews ?? []).map((p) => (
            <div key={p.category}>{p.name}: {p.gbPerHour.toFixed(2)} GB/hr · {p.mbPerMin.toFixed(1)} MB/min</div>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.profileAutoAssign}
            onChange={(event) => setData({ ...data, profileAutoAssign: event.target.checked })}
          />
          Assign an Polisharr profile after an eligible video transcode
        </label>
        <button className="btn" type="button" onClick={() => void api.syncProfiles().then((r) => setMsg(r.results.map((x) => `${x.created.length} created, ${x.updated.length} updated`).join(" · ") || "Profiles synced.")).catch((e: Error) => setMsg(e.message))}>
          Sync quality profiles
        </button>
        <p className="help">Sync creates or repairs Polisharr-named profiles without changing other profiles or global quality-size limits. Auto-assign applies only after a video transcode and never starts a search. Sonarr assigns the profile to the whole series.</p>
      </div>
      <EncodeSettings
        data={data}
        hardwareLabel={hw ? `${hw.backend}${hw.av1 ? ", AV1 encoder listed" : ", AV1 encoder not listed"}` : "checking…"}
        av1Available={Boolean(hw?.av1)}
        onChange={(patch) => setData({ ...data, ...patch })}
        onSave={save}
      />
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Suggestion exclusions</h2>
        <p className="help">An exclusion hides matching files from Suggestions. It does not delete files or cancel queued work.</p>
        <div className="flex flex-wrap gap-2">
          <select value={exclusion.kind} onChange={(event) => {
            const kind = event.target.value;
            if (kind === "path" || kind === "profile" || kind === "tag" || kind === "title") {
              setExclusion({ ...exclusion, kind });
            }
          }}>
            <option value="path">Path starts with</option><option value="profile">Quality profile</option><option value="tag">Tag id</option><option value="title">Title</option>
          </select>
          <input value={exclusion.value} onChange={(event) => setExclusion({ ...exclusion, value: event.target.value })} placeholder="Value to exclude" />
          <button className="btn" type="button" disabled={!exclusion.value.trim()} onClick={() => void api.addExclusion(exclusion.kind, exclusion.value).then((result) => {
            setExclusions(result.exclusions);
            setExclusion({ ...exclusion, value: "" });
          }).catch((error: Error) => setMsg(error.message))}>Add exclusion</button>
        </div>
        <ul className="space-y-2 text-sm">
          {exclusions.map((rule) => <li key={rule.id} className="flex items-center justify-between gap-2">
            <span>{rule.kind}: {rule.value}</span>
            <button className="btn-secondary danger" type="button" onClick={() => void api.deleteExclusion(rule.id).then((result) => setExclusions(result.exclusions))}>Remove</button>
          </li>)}
        </ul>
      </div>
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Connections</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={inst.kind} onChange={(e) => {
            const kind = e.target.value;
            if (kind === "radarr" || kind === "sonarr" || kind === "plex" || kind === "jellyfin") {
              setInst({ ...inst, kind });
            }
          }}>
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
                {row.name} · {row.kind} · {row.url} · {row.enabled ? "enabled" : "paused"} · {row.hasApiKey || row.hasToken ? "key saved" : "no key"}
              </span>
              <span className="flex gap-2">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => void api.saveInstance({
                    id: row.id,
                    kind: row.kind,
                    name: row.name,
                    url: row.url,
                    enabled: !row.enabled,
                  }).then(() => {
                    load();
                    onChange();
                    setMsg(row.enabled ? `${row.name} paused.` : `${row.name} enabled.`);
                  }).catch((e: Error) => setMsg(e.message))}
                >
                  {row.enabled ? "Pause" : "Enable"}
                </button>
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
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Radarr and Sonarr webhooks</h2>
        <p className="help">
          Polisharr can learn about a finished download as soon as Radarr or Sonarr imports it, instead of waiting for the next 15-minute sync. This does not start an encode.
        </p>
        <p className="text-sm">
          URL: <code>{typeof window !== "undefined" ? `${window.location.origin}/api/hooks/arr` : "/api/hooks/arr"}</code>
        </p>
        <p className="help">
          On the Arr Docker network use <code>http://polisharr:7373/api/hooks/arr</code>. In Connect, enable On Import, On Upgrade, and On Rename. Paste the token as header <code>X-Api-Key</code>, or as the Connect password. A query <code>?apikey=</code> works if the form only has a URL; that puts the token in access logs.
        </p>
        {webhookToken ? (
          <p className="text-sm">
            Token (shown once): <code>{webhookToken}</code>
          </p>
        ) : (
          <p className="help">{data.hasWebhookToken ? "A token is saved. Generate a new one to replace it." : "No token yet. Generate one before you add the Connect webhook."}</p>
        )}
        <button
          className="btn"
          type="button"
          onClick={() =>
            void api.mintWebhookToken().then((result) => {
              setWebhookToken(result.token);
              load();
              setMsg("Webhook token generated. Copy it now; Polisharr will not show it again.");
            }).catch((e: Error) => setMsg(e.message))
          }
        >
          {data.hasWebhookToken ? "Rotate webhook token" : "Generate webhook token"}
        </button>
      </div>
      <div className="glass space-y-3 p-4">
        <h2 className="font-semibold">Homepage widget</h2>
        <p className="help">
          Homepage can poll Polisharr for running title, queued, review, suggestions, and errors. The key is shown once.
        </p>
        {widgetKey ? (
          <p className="text-sm">
            Key (shown once): <code>{widgetKey}</code>
          </p>
        ) : (
          <p className="help">{data.hasWidgetKey ? "A widget key is saved. Generate a new one to replace it." : "No widget key yet. Generate one before you add the Homepage tile."}</p>
        )}
        <button
          className="btn"
          type="button"
          onClick={() =>
            void api.mintWidgetKey().then((result) => {
              setWidgetKey(result.key);
              load();
              setMsg("Widget key generated. Copy it now; Polisharr will not show it again.");
            }).catch((e: Error) => setMsg(e.message))
          }
        >
          {data.hasWidgetKey ? "Rotate widget key" : "Generate widget key"}
        </button>
      </div>
      {msg && <p className="ok text-sm">{msg}</p>}
    </section>
  );
}
