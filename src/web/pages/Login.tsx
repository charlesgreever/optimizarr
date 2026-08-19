import { useState } from "react";
import { api, type FirstRun } from "../api";

export function LoginPage({ firstRun, onReady }: { firstRun: FirstRun; onReady: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const setup = !firstRun.hasAdmin;

  return (
    <main className="auth-page">
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
        <div className="brand">
          <b>O</b>
          <strong>Optimizarr</strong>
        </div>
        <p className="eyebrow">{setup ? "FIRST RUN" : "WELCOME BACK"}</p>
        <h1>{setup ? "Create the Optimizarr admin" : "Sign in"}</h1>
        <p>
          {setup
            ? "This account is the only login. Choose a password you can remember; Optimizarr stores a hash, not the password itself."
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
