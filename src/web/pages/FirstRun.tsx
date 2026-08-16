import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LANGUAGES, api, type SetupStatus } from "../api";

type Step = "account" | "radarr" | "sonarr" | "plex" | "jellyfin" | "review";

export function FirstRun({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState<Step>("account");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("eng");

  const [arrName, setArrName] = useState("Radarr");
  const [arrUrl, setArrUrl] = useState("http://radarr:7878");
  const [arrKey, setArrKey] = useState("");

  const [playerName, setPlayerName] = useState("Plex");
  const [playerUrl, setPlayerUrl] = useState("http://plex:32400");
  const [playerToken, setPlayerToken] = useState("");

  const [reviewPath, setReviewPath] = useState("");
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    void api.status().then((s) => {
      setStatus(s);
      setStep(nextStep(s));
      if (s.reviewPath) setReviewPath(s.reviewPath);
      if (s.suggestedReviewPath) {
        setSuggested(s.suggestedReviewPath);
        if (!s.reviewPath) setReviewPath(s.suggestedReviewPath);
      }
    });
  }, []);

  useEffect(() => {
    if (step === "radarr") {
      setArrName((n) => (n === "Sonarr" || n === "" ? "Radarr" : n));
      setArrUrl((u) => (u.includes("sonarr") || u === "" ? "http://radarr:7878" : u));
    }
    if (step === "sonarr") {
      setArrName("Sonarr");
      setArrUrl("http://sonarr:8989");
    }
    if (step === "plex") {
      setPlayerName("Plex");
      setPlayerUrl("http://plex:32400");
    }
    if (step === "jellyfin") {
      setPlayerName("Jellyfin");
      setPlayerUrl("http://jellyfin:8096");
    }
  }, [step]);

  function skip() {
    setError(null);
    const s: SetupStatus = {
      needsFirstRun: false,
      languageConfirmed: true,
      setupComplete: true,
      onboardingComplete: false,
      authenticated: true,
      username: status?.username ?? null,
      hasRadarr: Boolean(status?.hasRadarr || step === "radarr"),
      hasSonarr: Boolean(status?.hasSonarr || step === "sonarr"),
      hasPlex: Boolean(status?.hasPlex || step === "plex"),
      hasJellyfin: Boolean(status?.hasJellyfin || step === "jellyfin"),
    };
    if (!s.hasRadarr && !s.hasSonarr) {
      setError("Add Radarr or Sonarr so Optimizarr has a library to work on.");
      return;
    }
    setStep(nextStep(s));
  }

  function applyStatus(s: SetupStatus) {
    setStatus(s);
    if (s.onboardingComplete) {
      onDone();
      return;
    }
    setStep(nextStep(s));
    if (s.suggestedReviewPath) {
      setSuggested(s.suggestedReviewPath);
      setReviewPath((current) => current || s.suggestedReviewPath || "");
    }
  }

  async function refreshStatus() {
    applyStatus(await api.status());
  }

  async function addArr(kind: "radarr" | "sonarr") {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createInstance({
        kind,
        name: arrName.trim() || (kind === "sonarr" ? "Sonarr" : "Radarr"),
        url: arrUrl,
        apiKey: arrKey,
      });
      const test = await api.testInstance(created.id);
      if (!test.ok) throw new Error(test.error || "Could not connect");
      const refresh = await api.refreshLibrary({ inspect: "none" });
      if (refresh.suggestedReviewPath) {
        setSuggested(refresh.suggestedReviewPath);
        setReviewPath((current) => current || refresh.suggestedReviewPath || "");
      }
      setArrKey("");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add instance");
    } finally {
      setBusy(false);
    }
  }

  async function addPlayer(kind: "plex" | "jellyfin") {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createPlayer({
        kind,
        name: playerName.trim() || (kind === "jellyfin" ? "Jellyfin" : "Plex"),
        url: playerUrl,
        token: playerToken,
      });
      await api.testPlayer(created.id);
      setPlayerToken("");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add player");
    } finally {
      setBusy(false);
    }
  }

  async function submitAccount(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.firstRun({ username, password, preferredLanguage });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveReview(e: FormEvent) {
    e.preventDefault();
    if (!reviewPath.trim()) {
      setError("Review path is required");
      return;
    }
    if (!status?.hasRadarr && !status?.hasSonarr) {
      setError("Add Radarr or Sonarr first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveSettings({ reviewPath: reviewPath.trim(), languageConfirmed: true });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save review path");
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);
  const subtitle = `${stepIndex + 1} of ${STEPS.length}`;

  return (
    <AuthCard title={TITLE[step]} subtitle={`${subtitle}: ${BLURB[step]}`}>
      <ol className="mb-6 flex flex-wrap gap-1 text-[11px] uppercase tracking-wide text-zinc-500">
        {STEPS.map((s, i) => (
          <li key={s} className={s === step ? "text-amber-400" : i < stepIndex ? "text-zinc-300" : ""}>
            {LABEL[s]}
            {i < STEPS.length - 1 ? " ·" : ""}
          </li>
        ))}
      </ol>

      {step === "account" && (
        <form className="space-y-4" onSubmit={(e) => void submitAccount(e)}>
          <Field label="Username">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Confirm password">
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Preferred language">
            <select className="input" value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs leading-5 text-zinc-500">
            Extra audio and subtitle tracks not in this language will be suggested for removal.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </button>
        </form>
      )}

      {(step === "radarr" || step === "sonarr") && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void addArr(step);
          }}
        >
          <Field label="Name">
            <input className="input" value={arrName} onChange={(e) => setArrName(e.target.value)} />
          </Field>
          <Field label="URL">
            <input className="input" value={arrUrl} onChange={(e) => setArrUrl(e.target.value)} />
          </Field>
          <Field label="API key">
            <input className="input" type="password" value={arrKey} onChange={(e) => setArrKey(e.target.value)} autoComplete="off" required />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Connecting…" : `Connect ${step === "sonarr" ? "Sonarr" : "Radarr"}`}
          </button>
          <button className="btn !bg-zinc-700 !text-zinc-100" type="button" disabled={busy} onClick={skip}>
            Skip for now
          </button>
        </form>
      )}

      {(step === "plex" || step === "jellyfin") && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void addPlayer(step);
          }}
        >
          <Field label="Name">
            <input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
          </Field>
          <Field label="URL">
            <input className="input" value={playerUrl} onChange={(e) => setPlayerUrl(e.target.value)} />
          </Field>
          <Field label="Token">
            <input className="input" type="password" value={playerToken} onChange={(e) => setPlayerToken(e.target.value)} autoComplete="off" required />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Connecting…" : `Connect ${step === "jellyfin" ? "Jellyfin" : "Plex"}`}
          </button>
          <button className="btn !bg-zinc-700 !text-zinc-100" type="button" disabled={busy} onClick={skip}>
            Skip for now
          </button>
        </form>
      )}

      {step === "review" && (
        <form className="space-y-4" onSubmit={(e) => void saveReview(e)}>
          <Field label="Review path">
            <input className="input" value={reviewPath} onChange={(e) => setReviewPath(e.target.value)} placeholder="/mnt/nas/optimizarr-review" required />
          </Field>
          {suggested && (
            <button
              className="text-left text-xs text-amber-400 hover:text-amber-300"
              type="button"
              onClick={() => setReviewPath(suggested)}
            >
              Use suggested path from your Arr libraries: {suggested}
            </button>
          )}
          <p className="text-xs leading-5 text-zinc-500">
            Sidecars land here so Radarr, Sonarr, and Plex do not see two files in a movie folder. Use a folder on the same NAS, outside the library roots.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Finish setup"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}

const STEPS: Step[] = ["account", "radarr", "sonarr", "plex", "jellyfin", "review"];
const LABEL: Record<Step, string> = {
  account: "Account",
  radarr: "Radarr",
  sonarr: "Sonarr",
  plex: "Plex",
  jellyfin: "Jellyfin",
  review: "Review path",
};
const TITLE: Record<Step, string> = {
  account: "Welcome to Optimizarr",
  radarr: "Connect Radarr",
  sonarr: "Connect Sonarr",
  plex: "Connect Plex",
  jellyfin: "Connect Jellyfin",
  review: "Where should sidecars go?",
};
const BLURB: Record<Step, string> = {
  account: "Create the admin account and confirm your preferred language.",
  radarr: "Use the same URL the container can reach, for example http://radarr:7878 on the Docker network shared with Radarr.",
  sonarr: "Same idea as Radarr. You can skip if you only run movies.",
  plex: "URL plus a Plex token. Optimizarr uses it to refresh Plex after Keep.",
  jellyfin: "Optional. Used to refresh Jellyfin after Keep.",
  review: "Suggested from the shared root of your Arr file paths.",
};

function nextStep(s: SetupStatus): Step {
  if (s.needsFirstRun || !s.languageConfirmed) return "account";
  if (!s.hasRadarr) return "radarr";
  if (!s.hasSonarr) return "sonarr";
  if (!s.hasPlex) return "plex";
  if (!s.hasJellyfin) return "jellyfin";
  return "review";
}

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="font-semibold">Optimizarr</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 mb-6 text-sm leading-6 text-zinc-400">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-zinc-300">{label}</span>
      {children}
    </label>
  );
}
