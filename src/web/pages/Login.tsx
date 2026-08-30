import { useState, type FormEvent } from "react";
import { api, type FirstRun } from "../api";
import { ThemeToggle } from "../components/ThemeToggle";

export function LoginPage({ firstRun, onReady }: { firstRun: FirstRun; onReady: () => void }) {
  const [error, setError] = useState("");
  const setup = !firstRun.hasAdmin;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "");
    const password = String(data.get("password") ?? "");
    const run = setup ? api.setup : api.login;
    void run(username, password)
      .then(onReady)
      .catch((err: Error) => setError(err.message));
  }

  return (
    <main className="auth-page relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        className="auth-card"
        method="post"
        action={setup ? "/api/auth/setup" : "/api/auth/login"}
        autoComplete="on"
        onSubmit={submit}
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
        <label htmlFor="username">
          Username
          <input
            id="username"
            name="username"
            placeholder="Username"
            type="text"
            inputMode="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label htmlFor="password">
          Password
          <input
            id="password"
            name="password"
            placeholder="Password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit">{setup ? "Create account" : "Sign in"}</button>
      </form>
    </main>
  );
}
