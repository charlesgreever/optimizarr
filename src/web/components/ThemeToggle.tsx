import { useState } from "react";
import { readDomTheme, toggleTheme, type Theme } from "../theme";
import { Icons } from "./icons";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readDomTheme);

  return (
    <button
      type="button"
      className="relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === "dark" ? Icons.sun() : Icons.moon()}
    </button>
  );
}
