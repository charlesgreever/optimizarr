// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

if (typeof localStorage === "undefined") {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
      clear: () => { memory.clear(); },
    },
  });
}
import { applyTheme, readStoredTheme, resolveTheme, toggleTheme } from "./theme";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("applies dark on the document element and stores the choice", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("toggleTheme flips dark to light", () => {
    applyTheme("dark");
    expect(toggleTheme()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("resolveTheme uses the stored theme", () => {
    localStorage.setItem("theme", "dark");
    expect(readStoredTheme()).toBe("dark");
    expect(resolveTheme()).toBe("dark");
  });
});
