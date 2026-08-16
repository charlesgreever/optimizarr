import { useEffect, useRef, useState, type FormEvent } from "react";
import { LANGUAGES, api, type ArrInstance, type Player, type Settings as SettingsModel } from "../api";

type Backends = { cuda: boolean; vaapi: boolean; av1: boolean };

export function Settings() {
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [instances, setInstances] = useState<ArrInstance[]>([]);
  const [instKind, setInstKind] = useState<"radarr" | "sonarr">("radarr");
  const [instName, setInstName] = useState("Radarr");
  const [instUrl, setInstUrl] = useState("");
  const [instKey, setInstKey] = useState("");
  const [instError, setInstError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerKind, setPlayerKind] = useState<"plex" | "jellyfin">("plex");
  const [playerName, setPlayerName] = useState("Plex");
  const [playerUrl, setPlayerUrl] = useState("");
  const [playerToken, setPlayerToken] = useState("");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerTestMsg, setPlayerTestMsg] = useState<string | null>(null);
  const [hw, setHw] = useState<Backends | null>(null);
  const [storageMsg, setStorageMsg] = useState<string | null>(null);
  const loadGen = useRef(0);

  function upsertById<T extends { id: number }>(list: T[], item: T): T[] {
    const rest = list.filter((row) => Number(row.id) !== Number(item.id));
    return [...rest, item].sort((a, b) => Number(a.id) - Number(b.id));
  }

  useEffect(() => {
    const gen = ++loadGen.current;
    api
      .settings()
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
    api.status().then((s) => setUsername(s.username ?? ""));
    api.instances().then((r) => {
      if (gen === loadGen.current) setInstances(r.items ?? []);
    });
    api.players().then((r) => {
      if (gen === loadGen.current) setPlayers(r.items ?? []);
    });
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
        workOnNas: settings.workOnNas,
        localCopy: settings.localCopy,
        copyMode: settings.copyMode,
        nasSshHost: settings.nasSshHost,
        nasSshUser: settings.nasSshUser,
        nasSshPort: settings.nasSshPort,
        nasSshIdentityFile: settings.nasSshIdentityFile,
        nasPathMaps: settings.nasPathMaps,
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
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.workOnNas}
            onChange={(e) => setSettings({ ...settings, workOnNas: e.target.checked })}
          />
          <span>
            <span className="block text-zinc-200">Work on the NAS paths</span>
            <span className="text-zinc-500">Sidecars and copies stay on the review path instead of a local scratch disk.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={settings.localCopy}
            onChange={(e) => setSettings({ ...settings, localCopy: e.target.checked })}
          />
          <span>
            <span className="block text-zinc-200">Copy locally before encode</span>
            <span className="text-zinc-500">Pull the source to this host first. Off unless the GPU host needs a local file.</span>
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-zinc-300">File copies</span>
          <select
            className="input"
            value={settings.copyMode ?? "auto"}
            onChange={(e) =>
              setSettings({
                ...settings,
                copyMode: e.target.value as SettingsModel["copyMode"],
              })
            }
          >
            <option value="auto">Auto — copy on the NAS when possible</option>
            <option value="ssh">On the NAS over SSH</option>
            <option value="mount">Kernel / SMB server-side copy</option>
            <option value="proxy">Through this host</option>
          </select>
          <span className="mt-1 block text-zinc-500">
            Auto tries an SSH `cp` on the NAS, then a kernel clone or SMB COPYCHUNK, and only then reads the file through this container.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">NAS SSH host</span>
            <input
              className="input"
              value={settings.nasSshHost}
              onChange={(e) => setSettings({ ...settings, nasSshHost: e.target.value })}
              placeholder="192.168.1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">NAS SSH user</span>
            <input
              className="input"
              value={settings.nasSshUser}
              onChange={(e) => setSettings({ ...settings, nasSshUser: e.target.value })}
              placeholder="cgreever"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">NAS SSH port</span>
            <input
              className="input"
              type="number"
              min={1}
              max={65535}
              value={settings.nasSshPort}
              onChange={(e) => setSettings({ ...settings, nasSshPort: Number(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">SSH identity file in the container</span>
            <input
              className="input"
              value={settings.nasSshIdentityFile}
              onChange={(e) => setSettings({ ...settings, nasSshIdentityFile: e.target.value })}
              placeholder="/config/nas_id_ed25519"
            />
          </label>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-zinc-300">Path maps (container → NAS)</span>
            <div className="flex gap-2">
              <button
                className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                type="button"
                onClick={() => {
                  void api
                    .storageInfo()
                    .then((info) => {
                      setSettings({
                        ...settings,
                        nasSshHost: settings.nasSshHost || info.suggestedHost,
                        nasPathMaps: info.suggestedMaps.length ? info.suggestedMaps : settings.nasPathMaps ?? [],
                      });
                      setStorageMsg(
                        info.suggestedMaps.length
                          ? `Suggested ${info.suggestedMaps.map((m) => `${m.localRoot} → ${m.remoteRoot}`).join(", ")}`
                          : "No CIFS/NFS mounts detected in this container.",
                      );
                    })
                    .catch((e: Error) => setStorageMsg(e.message));
                }}
              >
                Suggest from mounts
              </button>
              <button
                className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    nasPathMaps: [...(settings.nasPathMaps ?? []), { localRoot: "/mnt/nas", remoteRoot: "/volume1/Plex" }],
                  })
                }
              >
                Add map
              </button>
            </div>
          </div>
          {(settings.nasPathMaps ?? []).length === 0 && (
            <p className="text-sm text-zinc-500">
              Example: `/mnt/nas` → `/volume1/Plex` so a copy stays on GreeverNAS instead of streaming through this host.
            </p>
          )}
          {(settings.nasPathMaps ?? []).map((map, index) => (
            <div key={`${map.localRoot}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                className="input"
                value={map.localRoot}
                onChange={(e) => {
                  const nasPathMaps = (settings.nasPathMaps ?? []).map((row, i) =>
                    i === index ? { ...row, localRoot: e.target.value } : row,
                  );
                  setSettings({ ...settings, nasPathMaps });
                }}
                placeholder="/mnt/nas"
              />
              <input
                className="input"
                value={map.remoteRoot}
                onChange={(e) => {
                  const nasPathMaps = (settings.nasPathMaps ?? []).map((row, i) =>
                    i === index ? { ...row, remoteRoot: e.target.value } : row,
                  );
                  setSettings({ ...settings, nasPathMaps });
                }}
                placeholder="/volume1/Plex"
              />
              <button
                className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                type="button"
                onClick={() =>
                  setSettings({
                    ...settings,
                    nasPathMaps: (settings.nasPathMaps ?? []).filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="btn !w-auto"
            type="button"
            onClick={() => {
              void api
                .testStorage()
                .then((r) => setStorageMsg(r.ok ? r.detail || `Copy method: ${r.method}` : r.error || "Test failed"))
                .catch((e: Error) => setStorageMsg(e.message));
            }}
          >
            Test storage copy
          </button>
          {storageMsg && <p className="text-sm text-zinc-300">{storageMsg}</p>}
        </div>
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

      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-lg font-medium">Radarr / Sonarr</h2>
        <p className="text-sm text-zinc-500">
          Add each Arr separately. Optimizarr uses the same file paths they report — mount the NAS at that path in this container.
        </p>
        {instances.length === 0 && <p className="text-sm text-zinc-500">No instances connected yet.</p>}
        {instances.map((inst) => (
          <div key={`${inst.kind}-${inst.id}`} className="rounded-lg border border-zinc-800 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-300">
                {inst.kind}
              </span>
              <span className="font-medium">{inst.name}</span>
              {!inst.enabled && <span className="text-xs text-zinc-500">disabled</span>}
            </div>
            <div className="mt-1 text-zinc-500">{inst.url}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="btn !w-auto"
                type="button"
                onClick={() => {
                  void api
                    .testInstance(inst.id)
                    .then((r) => setTestMsg(`${inst.name}: ${r.ok ? `connected (v${r.version})` : r.error || "failed"}`))
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
              <button
                className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                type="button"
                onClick={() => {
                  void api.deleteInstance(inst.id).then(async () => {
                    const latest = await api.instances();
                    setInstances(latest.items);
                  });
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <form
          className="space-y-4 border-t border-zinc-800 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              setInstError(null);
              setTestMsg(null);
              try {
                const created = await api.createInstance({
                  kind: instKind,
                  name: instName.trim() || (instKind === "sonarr" ? "Sonarr" : "Radarr"),
                  url: instUrl,
                  apiKey: instKey,
                });
                loadGen.current += 1;
                setInstances((list) => upsertById(list, created));
                setInstKey("");
                setInstUrl("");
                setInstName(instKind === "sonarr" ? "Sonarr" : "Radarr");
                setSaved(true);
              } catch (err) {
                setInstError(err instanceof Error ? err.message : "Could not add instance");
              }
            })();
          }}
        >
          <h3 className="text-sm font-medium text-zinc-200">Add an instance</h3>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">Kind</span>
            <select
              className="input"
              value={instKind}
              onChange={(e) => {
                const next = e.target.value === "sonarr" ? "sonarr" : "radarr";
                setInstKind(next);
                if (instName === "Radarr" || instName === "Sonarr" || instName === "") {
                  setInstName(next === "sonarr" ? "Sonarr" : "Radarr");
                }
              }}
            >
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
            <input
              className="input"
              value={instUrl}
              onChange={(e) => setInstUrl(e.target.value)}
              placeholder={instKind === "sonarr" ? "http://192.168.1.10:8989" : "http://192.168.1.10:7878"}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">API key</span>
            <input
              className="input"
              type="password"
              value={instKey}
              onChange={(e) => setInstKey(e.target.value)}
              autoComplete="off"
            />
          </label>
          {instError && <p className="text-sm text-red-400">{instError}</p>}
          {testMsg && <p className="text-sm text-zinc-300">{testMsg}</p>}
          <button className="btn" type="submit">
            Add {instKind === "sonarr" ? "Sonarr" : "Radarr"}
          </button>
        </form>
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-lg font-medium">Media players</h2>
        <p className="text-sm text-zinc-500">
          Add Plex and Jellyfin separately. Tokens are saved and never shown again.
        </p>
        {players.length === 0 && <p className="text-sm text-zinc-500">No media players connected yet.</p>}
        {players.map((player) => (
          <div key={`${player.kind}-${player.id}`} className="rounded-lg border border-zinc-800 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-300">
                {player.kind}
              </span>
              <span className="font-medium">{player.name}</span>
              {!player.enabled && <span className="text-xs text-zinc-500">disabled</span>}
            </div>
            <div className="mt-1 text-zinc-500">{player.url}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="btn !w-auto"
                type="button"
                onClick={() => {
                  void api
                    .testPlayer(player.id)
                    .then((r) =>
                      setPlayerTestMsg(
                        `${player.name}: ${r.ok ? `connected${r.version ? ` (v${r.version})` : ""}` : r.error || "failed"}`,
                      ),
                    )
                    .catch((e: Error) => setPlayerTestMsg(`${player.name}: ${e.message}`));
                }}
              >
                Test
              </button>
              <button
                className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                type="button"
                onClick={() => {
                  void api.updatePlayer(player.id, { enabled: !player.enabled }).then((next) => {
                    setPlayers((list) => list.map((p) => (p.id === next.id ? next : p)));
                  });
                }}
              >
                {player.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="btn !w-auto !bg-zinc-700 !text-zinc-100"
                type="button"
                onClick={() => {
                  void api.deletePlayer(player.id).then(async () => {
                    const latest = await api.players();
                    setPlayers(latest.items);
                  });
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <form
          className="space-y-4 border-t border-zinc-800 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              setPlayerError(null);
              try {
                const created = await api.createPlayer({
                  kind: playerKind,
                  name: playerName.trim() || (playerKind === "jellyfin" ? "Jellyfin" : "Plex"),
                  url: playerUrl,
                  token: playerToken,
                });
                loadGen.current += 1;
                setPlayers((list) => upsertById(list, created));
                setPlayerToken("");
                setPlayerUrl("");
                setPlayerName(playerKind === "jellyfin" ? "Jellyfin" : "Plex");
                setSaved(true);
              } catch (err) {
                setPlayerError(err instanceof Error ? err.message : "Could not add player");
              }
            })();
          }}
        >
          <h3 className="text-sm font-medium text-zinc-200">Add a player</h3>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">Kind</span>
            <select
              className="input"
              value={playerKind}
              onChange={(e) => {
                const next = e.target.value === "jellyfin" ? "jellyfin" : "plex";
                setPlayerKind(next);
                if (playerName === "Plex" || playerName === "Jellyfin" || playerName === "") {
                  setPlayerName(next === "jellyfin" ? "Jellyfin" : "Plex");
                }
              }}
            >
              <option value="plex">Plex</option>
              <option value="jellyfin">Jellyfin</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">Name</span>
            <input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">URL</span>
            <input
              className="input"
              value={playerUrl}
              onChange={(e) => setPlayerUrl(e.target.value)}
              placeholder={playerKind === "jellyfin" ? "http://192.168.1.10:8096" : "http://192.168.1.10:32400"}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-zinc-300">Token</span>
            <input
              className="input"
              type="password"
              value={playerToken}
              onChange={(e) => setPlayerToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          {playerError && <p className="text-sm text-red-400">{playerError}</p>}
          {playerTestMsg && <p className="text-sm text-zinc-300">{playerTestMsg}</p>}
          <button className="btn" type="submit">
            Add {playerKind === "jellyfin" ? "Jellyfin" : "Plex"}
          </button>
        </form>
      </div>

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
