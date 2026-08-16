import { useState, type FormEvent, type ReactNode } from "react";
import { LANGUAGES, api } from "../api";

export function FirstRun({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("eng");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.firstRun({ username, password, preferredLanguage });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Welcome to Optimizarr" subtitle="Create the admin account and confirm your preferred language before any optimize run.">
      <form className="space-y-4" onSubmit={(e) => void submit(e)}>
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm password">
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
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
          Audio and subtitle cleanup will keep tracks in this language and drop the rest. You can change it later in Settings.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Start using Optimizarr"}
        </button>
      </form>
    </AuthCard>
  );
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
