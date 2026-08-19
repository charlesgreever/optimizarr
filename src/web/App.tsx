import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type FirstRun } from "./api";
import { Shell } from "./components/Shell";
import { HomePage } from "./pages/Home";
import { MoviesPage } from "./pages/Movies";
import { SeriesPage } from "./pages/Series";
import { SuggestionsPage } from "./pages/Suggestions";
import { QueuePage } from "./pages/Queue";
import { ReviewPage } from "./pages/Review";
import { ErrorsPage } from "./pages/Errors";
import { HistoryPage } from "./pages/History";
import { SettingsPage } from "./pages/Settings";
import { LoginPage } from "./pages/Login";

export function App() {
  const [auth, setAuth] = useState<{ authenticated: boolean; firstRun: FirstRun } | null>(null);

  useEffect(() => {
    void api.status().then(setAuth).catch(() => setAuth({ authenticated: false, firstRun: emptyFirst() }));
  }, []);

  if (!auth) return <div className="auth-page"><p className="help">Loading Optimizarr…</p></div>;
  if (!auth.firstRun.hasAdmin || !auth.authenticated) {
    return <LoginPage firstRun={auth.firstRun} onReady={() => void api.status().then(setAuth)} />;
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/movies" element={<MoviesPage />} />
        <Route path="/series" element={<SeriesPage />} />
        <Route path="/suggestions" element={<SuggestionsPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/errors" element={<ErrorsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage firstRun={auth.firstRun} onChange={() => void api.status().then(setAuth)} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function emptyFirst(): FirstRun {
  return { hasAdmin: false, languageConfirmed: false, hasReviewPath: false, hasArr: false, complete: false };
}
