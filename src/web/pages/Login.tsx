import { useState } from "react";
import { api, type FirstRun } from "../api";
import { ThemeToggle } from "../components/ThemeToggle";

export function LoginPage({ firstRun, onReady }: { firstRun: FirstRun; onReady: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const setup = !firstRun.hasAdmin;

  return (
    <main className="auth-page relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          const run = setup ? api.setup : api.login;
          void run(username, password)
            .then(onReady)
            .catch((err: Error) => setError(err.message));
        }}
      >
        <div className="mb-8 flex items-center gap-3">
          <b className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-semibold text-white">P</b>
          <strong className="text-base font-semibold text-gray-800 dark:text-white/90">Polisharr</strong>
        </div>
        <p className="eyebrow">{setup ? "FIRST RUN" : "WELCOME BACK"}</p>
        <h1>{setup ? "Create the Polisharr admin" : "Sign in"}</h1>
        <p>
          {setup
            ? "This account is the only login. Choose a password you can remember; Polisharr stores a hash, not the password itself."
            : "Use the administrator account created on first run."}
        </p>
        <label>
          Username
          <input
            placeholder="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            placeholder="Password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit">{setup ? "Create account" : "Sign in"}</button>
      </form>
    </main>
  );
}
