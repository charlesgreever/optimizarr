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
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <LogoMark className="h-7 w-7 rounded-md" />
          <span className="font-semibold tracking-tight">Optimizarr</span>
        </div>
        <button
          type="button"
          className="rounded-md px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </button>
      </header>

      <aside
        className={`${open ? "flex" : "hidden"} w-full flex-col border-b border-zinc-800 bg-zinc-900 md:flex md:w-56 md:border-b-0 md:border-r`}
      >
        <div className="hidden items-center gap-2 px-5 py-5 md:flex">
          <LogoMark className="h-8 w-8 rounded-md" />
          <div>
            <div className="text-base font-semibold tracking-tight">Optimizarr</div>
            <div className="text-xs text-zinc-500">Companion *arr</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-amber-500/15 font-medium text-amber-300"
                    : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                }`
              }
            >
              <item.Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-4 text-xs text-zinc-500">
          <div className="mb-2 truncate text-zinc-300">{username}</div>
          {!setupComplete && <div className="mb-2 text-amber-400">Finish setup</div>}
          <button type="button" className="text-zinc-400 hover:text-white" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-5 md:p-8">
        <InspectBanner />
        {children}
      </main>
    </div>
  );
}
