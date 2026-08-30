// @vitest-environment happy-dom
import { createElement } from "react";

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
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme } from "../theme";
import { ThemeToggle } from "./ThemeToggle";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.body.replaceChildren();
});

describe("theme toggle", () => {
  it("puts dark on the document element when clicked", async () => {
    applyTheme("light");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(ThemeToggle));
    });
    const button = host.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Switch to dark mode");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(button?.getAttribute("aria-label")).toBe("Switch to light mode");
    await act(async () => {
      root.unmount();
    });
  });
});
