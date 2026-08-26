import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { api, type InspectState, type SearchHit } from "../api";
import { inspectBannerView } from "../inspect-banner";
import { headerWorkLine, navCount } from "../nav-work";
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
  const [work, setWork] = useState({ queueActive: 0, review: 0, runningTitle: null as string | null });
  const [dismissedFailed, setDismissedFailed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
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
        const [inspectState, workState] = await Promise.all([
          api.inspect(),
          api.work().catch(() => null),
        ]);
        setInspect(inspectState);
        if (workState) {
          setWork({
            queueActive: workState.queueActive,
            review: workState.review,
            runningTitle: workState.runningTitle,
          });
        }
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

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const banner = inspectBannerView(inspect, dismissedFailed);
  const inspecting = banner.inspecting;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
          aria-label="Close menu"
          onClick={() => {
            setSidebarOpen(false);
            menuBtnRef.current?.focus();
          }}
        />
      )}
      <aside
        className={`fixed top-0 left-0 z-50 flex h-screen w-72 flex-col border-r border-ink/10 bg-white duration-300 lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-6 py-6">
          <b className="grid h-8 w-8 place-items-center rounded bg-ink font-display text-sm text-canvas">P</b>
          <strong className="text-base font-semibold text-ink">Polisharr</strong>
        </div>
        <nav className="flex flex-col gap-1 overflow-y-auto px-4 pb-6">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                  isActive
                    ? "bg-canvas text-ink shadow-[inset_3px_0_0_0_#2196f3]"
                    : "text-muted hover:bg-canvas hover:text-ink"
                }`
              }
            >
              {item.icon()}
              <span>{item.label}</span>
              {item.to === "/queue" && navCount(work.queueActive) != null && (
                <span className="ml-auto font-mono text-xs tabular-nums text-accent">{navCount(work.queueActive)}</span>
              )}
              {item.to === "/review" && navCount(work.review) != null && (
                <span className="ml-auto font-mono text-xs tabular-nums text-accent">{navCount(work.review)}</span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink/10 bg-white px-4 py-3 md:px-6">
          <button
            ref={menuBtnRef}
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-ink/15 text-ink lg:hidden"
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            {Icons.menu()}
          </button>
          <div className="global-search min-w-0 flex-1">
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
                      setSidebarOpen(false);
                    }}
                  >
                    {hit.displayTitle}
                    <span className="muted">{hit.instanceName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="hidden shrink-0 font-mono text-xs text-muted sm:block">
            {headerWorkLine(inspecting, inspect?.pending ?? 0, work.runningTitle)}
          </div>
          <ReportBug inspect={inspect} />
        </header>
        {inspecting && (
          <div className="inspect-banner mx-4 mt-4 md:mx-6">
            Movie and series lists are ready. Inspecting leftover files. {banner.pending} left.
            {banner.failed > 0 ? ` ${banner.failed} files could not be read.` : ""}
          </div>
        )}
        {banner.showFailed && (
          <div className="inspect-banner mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 md:mx-6">
            <span>
              {banner.failed} files could not be probed.{" "}
              <Link className="font-medium text-ink hover:text-accent" to="/errors">Open Errors</Link>
            </span>
            <button className="btn-secondary" type="button" onClick={() => setDismissedFailed(true)}>
              Dismiss
            </button>
          </div>
        )}
        <main className="mx-auto w-full max-w-screen-2xl p-4 md:p-6">{children}</main>
      </div>
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
    <div className="flex shrink-0 items-center gap-1">
      <button className="btn-secondary" type="button" onClick={() => void report("bug")} disabled={busy}>
        Bug
      </button>
      <button className="btn-secondary hidden sm:inline-flex" type="button" onClick={() => void report("change")} disabled={busy}>
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
