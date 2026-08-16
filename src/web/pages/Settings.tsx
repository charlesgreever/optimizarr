import { useEffect, useState, type FormEvent } from "react";
import { LANGUAGES, api, type Settings as SettingsModel } from "../api";

export function Settings() {
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    api
      .settings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
    api.status().then((s) => setUsername(s.username ?? ""));
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
        <button className="btn" type="submit">
          Save settings
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
