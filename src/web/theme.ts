export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* private mode */
  }
  return null;
}

export function preferredTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(): Theme {
  return readStoredTheme() ?? preferredTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}

export function readDomTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function toggleTheme(): Theme {
  const next: Theme = readDomTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
