import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";

const NAV = [
  { to: "/movies", label: "Movies" },
  { to: "/series", label: "Series" },
  { to: "/suggestions", label: "Suggestions" },
  { to: "/queue", label: "Queue" },
  { to: "/review", label: "Review" },
  { to: "/history", label: "History" },
  { to: "/settings", label: "Settings" },
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
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
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
          <span className="h-3 w-3 rounded-full bg-amber-400" />
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
                `rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-amber-500/15 font-medium text-amber-300"
                    : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                }`
              }
            >
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

      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
