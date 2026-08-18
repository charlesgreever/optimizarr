import { useState } from "react";
import { api, type FirstRun } from "../api";

export function LoginPage({ firstRun, onReady }: { firstRun: FirstRun; onReady: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const setup = !firstRun.hasAdmin;

  return (
    <div className="mx-auto mt-24 max-w-md p-6">
      <div className="glass p-6">
        <div className="mb-4 flex items-center gap-2 text-xl font-semibold">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          {setup ? "Create the Optimizarr admin" : "Sign in"}
        </div>
        <p className="help mb-4">
          {setup
            ? "This account is the only login. Choose a password you can remember; Optimizarr stores a hash, not the password itself."
            : "Use the administrator account created on first run."}
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const run = setup ? api.setup : api.login;
            void run(username, password)
              .then(onReady)
              .catch((err: Error) => setError(err.message));
          }}
        >
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button className="btn w-full justify-center" type="submit">
            {setup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
