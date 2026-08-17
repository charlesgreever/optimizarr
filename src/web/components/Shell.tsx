import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import { InspectBanner } from "./InspectBanner";
import {
  HistoryIcon,
  LogoMark,
  MoviesIcon,
  QueueIcon,
  ReviewIcon,
  SeriesIcon,
  SettingsIcon,
  SuggestionsIcon,
} from "./icons";

const NAV: Array<{
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { to: "/movies", label: "Movies", Icon: MoviesIcon },
  { to: "/series", label: "Series", Icon: SeriesIcon },
  { to: "/suggestions", label: "Suggestions", Icon: SuggestionsIcon },
  { to: "/queue", label: "Queue", Icon: QueueIcon },
  { to: "/review", label: "Review", Icon: ReviewIcon },
  { to: "/history", label: "History", Icon: HistoryIcon },
  { to: "/settings", label: "Settings", Icon: SettingsIcon },
];

type Props = {
  username: string;
  setupComplete: boolean;
  onLogout: () => void;
  children: ReactNode;
};

export function Shell({ username, setupComplete, onLogout, children }: Props) {
  const [open, setOpen] = useState(false);

  async function logout() {
    await api.logout();
    onLogout();
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden md:flex-row">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/60 to-transparent" />
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.08] bg-zinc-950/85 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-2">
          <LogoMark className="h-7 w-7 rounded-md" />
          <span className="font-semibold tracking-tight">Optimizarr</span>
        </div>
        <button
          type="button"
          className="btn-secondary !rounded-lg !px-3 !py-1.5"
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </button>
      </header>

      <aside
        className={`${open ? "flex" : "hidden"} z-20 w-full flex-col border-b border-white/[0.08] bg-zinc-950/95 backdrop-blur-xl md:fixed md:inset-y-0 md:left-0 md:flex md:w-64 md:border-b-0 md:border-r`}
      >
        <div className="hidden items-center gap-3 px-5 py-6 md:flex">
          <LogoMark className="h-10 w-10 rounded-xl shadow-lg shadow-amber-950/30" />
          <div>
            <div className="text-base font-semibold tracking-[-0.02em]">Optimizarr</div>
            <div className="mt-0.5 text-[0.66rem] font-medium uppercase tracking-[0.18em] text-zinc-600">Media control</div>
          </div>
        </div>
        <div className="mx-5 hidden items-center gap-2 rounded-xl border border-emerald-400/10 bg-emerald-400/[0.04] px-3 py-2 text-xs text-zinc-400 md:flex">
          <span className="status-dot" />
          System online
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3 md:mt-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? "border border-amber-300/10 bg-gradient-to-r from-amber-400/15 to-transparent font-medium text-amber-200 shadow-inner shadow-amber-300/[0.03]"
                    : "border border-transparent text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100"
                }`
              }
            >
              <item.Icon className="h-[1.05rem] w-[1.05rem] shrink-0 transition group-hover:scale-105" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/[0.07] p-4 text-xs text-zinc-500">
          <div className="mb-3 flex items-center gap-2.5 rounded-xl bg-white/[0.03] p-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/10 font-semibold text-amber-300">
              {username.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-300">{username}</span>
          </div>
          {!setupComplete && <div className="mb-2 text-amber-400">Finish setup</div>}
          <button type="button" className="px-2 text-zinc-500 transition hover:text-white" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>

      <main className="relative flex-1 p-5 md:ml-64 md:p-8 lg:p-10">
        <div className="mx-auto max-w-[92rem]">
          <InspectBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
