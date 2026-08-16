import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, type SetupStatus } from "./api";
import { Shell } from "./components/Shell";
import { EmptyPage } from "./pages/EmptyPage";
import { FirstRun } from "./pages/FirstRun";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";

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

  if (status.needsFirstRun) {
    return <FirstRun onDone={refresh} />;
  }
  if (!status.authenticated) {
    return <Login onDone={refresh} />;
  }

  return (
    <Shell username={status.username ?? "admin"} onLogout={refresh} setupComplete={status.setupComplete}>
      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route
          path="/movies"
          element={
            <EmptyPage
              title="Movies"
              load={api.movies}
              fallback="Connect Radarr in Settings to sync your library."
            />
          }
        />
        <Route
          path="/series"
          element={
            <EmptyPage
              title="Series"
              load={api.series}
              fallback="Connect Sonarr in Settings to sync your library."
            />
          }
        />
        <Route
          path="/suggestions"
          element={
            <EmptyPage
              title="Suggestions"
              load={api.suggestions}
              fallback="After your library syncs, suggested optimizations will show up here."
            />
          }
        />
        <Route
          path="/queue"
          element={
            <EmptyPage
              title="Queue"
              load={api.queue}
              fallback="Approved work will appear here."
            />
          }
        />
        <Route
          path="/review"
          element={
            <EmptyPage
              title="Review"
              load={api.review}
              fallback="Finished sidecars wait here for Keep or Discard."
            />
          }
        />
        <Route
          path="/history"
          element={
            <EmptyPage
              title="History"
              load={api.history}
              fallback="Completed jobs will be listed here."
            />
          }
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/movies" replace />} />
      </Routes>
    </Shell>
  );
}
