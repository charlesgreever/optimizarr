import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, type InspectState, type SearchHit } from "../api";
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
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) void api.search(q).then((r) => setHits(r.items)).catch(() => setHits([]));
      else setHits([]);
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

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

  const inspecting = Boolean(inspect && (inspect.walking || inspect.pending > 0));

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <b>O</b>
          <strong>Optimizarr</strong>
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
          <small>{inspecting ? `Inspecting · ${inspect?.pending ?? 0} left` : "● Ready"}</small>
        </header>
        {inspecting && (
          <div className="inspect-banner">
            Movie and series lists are ready. Inspecting leftover files. {inspect?.pending} left.
            {inspect && inspect.failed > 0 ? ` ${inspect.failed} files could not be read.` : ""}
          </div>
        )}
        <div className="page">{children}</div>
      </main>
    </div>
  );
}

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">OPTIMIZARR</p>
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
