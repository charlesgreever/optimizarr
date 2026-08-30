import { useSearchParams } from "react-router-dom";
import { type FirstRun } from "../api";
import { ThemeToggle } from "../components/ThemeToggle";

export function LoginPage({ firstRun }: { firstRun: FirstRun; onReady?: () => void }) {
  const [params] = useSearchParams();
  const setup = !firstRun.hasAdmin;
  const error = params.get("error") ? "Username or password is wrong." : "";

  return (
    <main className="auth-page relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        id="polisharr-login"
        className="auth-card"
        method="post"
        action={setup ? "/api/auth/setup" : "/api/auth/login"}
        autoComplete="on"
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
        <label htmlFor="username">Username</label>
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
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          placeholder="Password"
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          required
        />
        {error && <div className="form-error">{error}</div>}
        <button type="submit" name="submit">{setup ? "Create account" : "Sign in"}</button>
      </form>
    </main>
  );
}
