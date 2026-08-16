import { useEffect, useState, type FormEvent } from "react";
import { LANGUAGES, api, type ArrInstance, type Settings as SettingsModel } from "../api";

type Backends = { cuda: boolean; vaapi: boolean; av1: boolean };

export function Settings() {
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [instances, setInstances] = useState<ArrInstance[]>([]);
  const [instName, setInstName] = useState("Radarr");
  const [instUrl, setInstUrl] = useState("");
  const [instKey, setInstKey] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [hw, setHw] = useState<Backends | null>(null);

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
    api.status().then((s) => setUsername(s.username ?? ""));
    api.instances().then((r) => setInstances(r.items));
    api.hardware().then(setHw).catch(() => undefined);
  }, []);

  if (!settings) {
    return <p className="text-zinc-400">{error ?? "Loading settings…"}</p>;
  }

  async function saveGeneral(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const next = await api.saveSettings({
        preferredLanguage: settings.preferredLanguage,
        languageConfirmed: true,
        localAuthBypass: settings.localAuthBypass,
        sizeCapsGbPerHour: settings.sizeCapsGbPerHour,
        reviewPath: settings.reviewPath,
        autoOptimize: settings.autoOptimize,
        concurrency: settings.concurrency,
        offPeakEnabled: settings.offPeakEnabled,
        targetCodec: settings.targetCodec,
      });
      setSettings(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function saveAccount(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api.updateCredentials({
        currentPassword,
        username,
        password: password || undefined,
      });
      setCurrentPassword("");
      setPassword("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account update failed");
    }
  }

  return (
    <section className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Secrets are never shown after they are saved.</p>
      </div>

      <form className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6" onSubmit={(e) => void saveGeneral(e)}>
        <h2 className="text-lg font-medium">General</h2>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Preferred language</span>
          <select
            className="input"
            value={settings.preferredLanguage}
            onChange={(e) => setSettings({ ...settings, preferredLanguage: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.localAuthBypass}
            onChange={(e) => setSettings({ ...settings, localAuthBypass: e.target.checked })}
          />
          <span>
            <span className="block text-zinc-200">Allow local addresses without a password</span>
            <span className="text-zinc-500">
              RFC1918 and loopback clients skip login when this is on, like Radarr and Sonarr. Leave off unless you trust the LAN.
            </span>
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Review path (NAS, outside library folders)</span>
          <input
            className="input"
            value={settings.reviewPath}
            onChange={(e) => setSettings({ ...settings, reviewPath: e.target.value })}
            placeholder="/mnt/nas/optimizarr-review"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["movie1080p", "Movie 1080p GB/hr"],
              ["movie4kSdr", "Movie 4K SDR GB/hr"],
              ["movie4kHdr", "Movie 4K HDR GB/hr"],
              ["tv1080p", "TV 1080p GB/hr"],
              ["tv4k", "TV 4K GB/hr"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-sm">
              <span className="mb-1.5 block text-zinc-300">{label}</span>
              <input
                className="input"
                type="number"
                step="0.1"
                min="0.1"
                value={settings.sizeCapsGbPerHour[key]}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    sizeCapsGbPerHour: { ...settings.sizeCapsGbPerHour, [key]: Number(e.target.value) },
                  })
                }
              />
            </label>
          ))}
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.autoOptimize}
            onChange={(e) => setSettings({ ...settings, autoOptimize: e.target.checked })}
          />
          <span>Auto-optimize new imports (still requires Keep)</span>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Concurrent jobs</span>
          <input
            className="input"
            type="number"
            min={1}
            value={settings.concurrency}
            onChange={(e) => setSettings({ ...settings, concurrency: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.offPeakEnabled}
            onChange={(e) => setSettings({ ...settings, offPeakEnabled: e.target.checked })}
          />
          <span>Only run jobs in the off-peak window ({settings.offPeakStart}–{settings.offPeakEnd})</span>
        </label>
        {hw && (
          <p className="text-xs text-zinc-500">
            Hardware: CUDA {hw.cuda ? "yes" : "no"} · VAAPI {hw.vaapi ? "yes" : "no"} · AV1 {hw.av1 ? "yes" : "no"}
          </p>
        )}
        <button className="btn" type="submit">
          Save settings
        </button>
      </form>

      <form
        className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setError(null);
            setTestMsg(null);
            try {
              const created = await api.createInstance({
                kind: (document.getElementById("arr-kind") as HTMLSelectElement)?.value === "sonarr" ? "sonarr" : "radarr",
                name: instName,
                url: instUrl,
                apiKey: instKey,
              });
              setInstances((list) => [...list, created]);
              setInstKey("");
              setSaved(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not add instance");
            }
          })();
        }}
      >
        <h2 className="text-lg font-medium">Radarr / Sonarr</h2>
        <p className="text-sm text-zinc-500">
          Optimizarr uses the same file paths Radarr reports. Mount the NAS at that path in this container.
        </p>
        {instances.map((inst) => (
          <div key={inst.id} className="rounded-lg border border-zinc-800 p-3 text-sm">
            <div className="font-medium">{inst.name}</div>
            <div className="text-zinc-500">{inst.url}</div>
            <div className="mt-2 flex gap-2">
              <button
                className="btn !w-auto"
                type="button"
                onClick={() => {
                  void api
                    .testInstance(inst.id)
                    .then((r) => setTestMsg(r.ok ? `Connected (v${r.version})` : r.error || "Failed"))
                    .catch((e: Error) => setTestMsg(e.message));
                }}
              >
                Test
              </button>
              <button
                className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                type="button"
                onClick={() => {
                  void api.updateInstance(inst.id, { enabled: !inst.enabled }).then((next) => {
                    setInstances((list) => list.map((i) => (i.id === next.id ? next : i)));
                  });
                }}
              >
                {inst.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Kind</span>
          <select className="input" id="arr-kind" defaultValue="radarr">
            <option value="radarr">Radarr</option>
            <option value="sonarr">Sonarr</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Name</span>
          <input className="input" value={instName} onChange={(e) => setInstName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">URL</span>
          <input className="input" value={instUrl} onChange={(e) => setInstUrl(e.target.value)} placeholder="http://192.168.1.10:7878" />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">API key</span>
          <input className="input" type="password" value={instKey} onChange={(e) => setInstKey(e.target.value)} autoComplete="off" />
        </label>
        {testMsg && <p className="text-sm text-zinc-300">{testMsg}</p>}
        <button className="btn" type="submit">
          Add Radarr
        </button>
      </form>

      <form
        className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          void api
            .createPlayer({
              kind: data.get("kind") as "plex" | "jellyfin",
              name: String(data.get("name") ?? ""),
              url: String(data.get("url") ?? ""),
              token: String(data.get("token") ?? ""),
            })
            .then(() => setSaved(true));
        }}
      >
        <h2 className="text-lg font-medium">Media players</h2>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Kind</span>
          <select className="input" name="kind" defaultValue="plex">
            <option value="plex">Plex</option>
            <option value="jellyfin">Jellyfin</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Name</span>
          <input className="input" name="name" required />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">URL</span>
          <input className="input" name="url" placeholder="http://192.168.1.10:32400" required />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Token</span>
          <input className="input" type="password" name="token" required />
        </label>
        <button className="btn" type="submit">
          Add player
        </button>
      </form>

      <form className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6" onSubmit={(e) => void saveAccount(e)}>
        <h2 className="text-lg font-medium">Account</h2>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Username</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">Current password</span>
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">New password (optional)</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
          />
        </label>
        <button className="btn" type="submit">
          Update account
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-400">Saved.</p>}
    </section>
  );
}
