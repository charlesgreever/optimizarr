import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, type SetupStatus } from "./api";
import { Shell } from "./components/Shell";
import { FirstRun } from "./pages/FirstRun";
import { History } from "./pages/History";
import { Login } from "./pages/Login";
import { Movies } from "./pages/Movies";
import { Queue } from "./pages/Queue";
import { Review } from "./pages/Review";
import { Series } from "./pages/Series";
import { Settings } from "./pages/Settings";
import { Suggestions } from "./pages/Suggestions";

export default function App() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  async function refresh() {
    try {
      setStatus(await api.status());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach Optimizarr");
    }
  }

  useEffect(() => {
    void refresh();
  }, [location.pathname]);

  if (error && !status) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-red-300">
        {error}
      </div>
    );
  }
  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-400">Loading…</div>
    );
  }

  if (status.needsFirstRun || (status.authenticated && status.onboardingComplete === false)) {
    return <FirstRun onDone={refresh} />;
  }
  if (!status.authenticated) {
    return <Login onDone={refresh} />;
  }

  return (
    <Shell username={status.username ?? "admin"} onLogout={refresh} setupComplete={status.setupComplete}>
      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route path="/movies" element={<Movies />} />
        <Route path="/series" element={<Series />} />
        <Route path="/suggestions" element={<Suggestions />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/review" element={<Review />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/movies" replace />} />
      </Routes>
    </Shell>
  );
}
