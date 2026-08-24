import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type InspectState, type SearchHit } from "../api";
import { inspectBannerView } from "../inspect-banner";
import { buildReportIssueUrl, type ReportKind } from "../reportIssue";
import { Icons } from "./icons";

const NAV = [
  { to: "/", label: "Home", icon: Icons.home },
  { to: "/movies", label: "Movies", icon: Icons.movies },
  { to: "/series", label: "Series", icon: Icons.series },
  { to: "/suggestions", label: "Suggestions", icon: Icons.suggestions },
  { to: "/queue", label: "Queue", icon: Icons.queue },
  { to: "/review", label: "Review", icon: Icons.review },
  { to: "/errors", label: "Errors", icon: Icons.errors },
  { to: "/history", label: "History", icon: Icons.history },
  { to: "/settings", label: "Settings", icon: Icons.settings },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [inspect, setInspect] = useState<InspectState | null>(null);
  const [dismissedFailed, setDismissedFailed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) void api.search(q).then((r) => setHits(r.items)).catch(() => setHits([]));
      else setHits([]);
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    void api.refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        setInspect(await api.inspect());
      } catch {
        /* still signed in later */
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const banner = inspectBannerView(inspect, dismissedFailed);
  const inspecting = banner.inspecting;

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <b>P</b>
          <strong>Polisharr</strong>
        </div>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              {item.icon()}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main>
        <header>
          <div className="global-search">
            <label>
              {Icons.search()}
              <input
                placeholder="Search movies and episodes"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search movies and episodes"
              />
            </label>
            {hits.length > 0 && (
              <div className="search-results">
                {hits.map((hit) => (
                  <button
                    key={hit.itemId}
                    type="button"
                    onClick={() => {
                      navigate(hit.href);
                      setQ("");
                      setHits([]);
                    }}
                  >
                    {hit.displayTitle}
                    <span className="muted">{hit.instanceName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="header-actions">
            <small>{inspecting ? `Inspecting · ${inspect?.pending ?? 0} left` : "● Ready"}</small>
          </div>
        </header>
        {inspecting && (
          <div className="inspect-banner">
            Movie and series lists are ready. Inspecting leftover files. {banner.pending} left.
            {banner.failed > 0 ? ` ${banner.failed} files could not be read.` : ""}
          </div>
        )}
        {banner.showFailed && (
          <div className="inspect-banner flex flex-wrap items-center justify-between gap-2">
            <span>
              {banner.failed} files could not be probed.{" "}
              <Link className="font-medium text-ink hover:text-accent" to="/errors">Open Errors</Link>
            </span>
            <button className="btn-secondary" type="button" onClick={() => setDismissedFailed(true)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="page">{children}</div>
      </main>
      <ReportBug inspect={inspect} />
    </div>
  );
}

function ReportBug({ inspect }: { inspect: InspectState | null }) {
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  async function report(kind: ReportKind) {
    setBusy(true);
    try {
      const jobs = await api.jobs();
      const running = jobs.items.find((job) => job.status === "running") ?? null;
      window.open(
        buildReportIssueUrl(kind, { route: location.pathname, inspect, running }),
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="report-bug">
      <span className="report-bug-label">{Icons.bug()} Report</span>
      <button className="btn-secondary" type="button" onClick={() => void report("bug")} disabled={busy}>
        Bug
      </button>
      <button className="btn-secondary" type="button" onClick={() => void report("change")} disabled={busy}>
        Change request
      </button>
    </div>
  );
}

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">POLISHARR</p>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Help({ children }: { children: string }) {
  return (
    <p className="help flex items-start gap-2">
      <span className="mt-0.5">{Icons.help()}</span>
      <span>{children}</span>
    </p>
  );
}
