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
  const [menu, setMenu] = useState(false);
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

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col gap-1 p-4 md:flex">
        <div className="mb-4 flex items-center gap-2 px-2 text-lg font-semibold">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          Optimizarr
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${isActive ? "bg-white/10 text-[#21d4fd]" : "text-slate-300 hover:bg-white/5"}`
            }
          >
            {item.icon()}
            {item.label}
          </NavLink>
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-4 py-3 md:px-8">
          <button className="btn-secondary md:hidden" type="button" onClick={() => setMenu((m) => !m)} aria-label="Open menu">
            <img src="/favicon.svg" alt="" className="h-5 w-5" />
          </button>
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-2.5 text-slate-500">{Icons.search()}</span>
            <input
              className="w-full pl-10"
              placeholder="Search movies and episodes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {hits.length > 0 && (
              <ul className="glass absolute z-20 mt-2 w-full overflow-hidden">
                {hits.map((hit) => (
                  <li key={hit.itemId}>
                    <button
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                      type="button"
                      onClick={() => {
                        navigate(hit.href);
                        setQ("");
                        setHits([]);
                      }}
                    >
                      {hit.displayTitle}
                      <span className="ml-2 text-xs text-slate-500">{hit.instanceName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </header>
        {inspect && (inspect.walking || inspect.pending > 0) && (
          <div className="mx-4 mb-2 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-sm text-amber-100 md:mx-8">
            Movie and series lists are ready. Inspecting leftover files with ffprobe. {inspect.pending} left.
            {inspect.failed > 0 ? ` ${inspect.failed} files could not be read.` : ""}
          </div>
        )}
        {menu && (
          <nav className="grid grid-cols-2 gap-2 px-4 pb-3 md:hidden">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className="glass flex items-center gap-2 px-3 py-2 text-sm" onClick={() => setMenu(false)}>
                {item.icon()}
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <main className="min-w-0 flex-1 px-4 pb-10 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export function Help({ children }: { children: string }) {
  return (
    <p className="help mt-2 flex items-start gap-2">
      <span className="mt-0.5 text-[#21d4fd]">{Icons.help()}</span>
      <span>{children}</span>
    </p>
  );
}
