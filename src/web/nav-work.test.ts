import { describe, expect, it } from "vitest";
import { headerWorkLine, navCount } from "./nav-work.ts";

describe("sidebar work counts", () => {
  it("hides a zero badge and names a running job in the header", () => {
    expect(navCount(0)).toBeNull();
    expect(navCount(3)).toBe(3);
    expect(headerWorkLine(true, 4, "Film")).toBe("Inspecting · 4 left");
    expect(headerWorkLine(false, 0, "Film")).toBe("Working · Film");
    expect(headerWorkLine(false, 0, null)).toBe("● Ready");
  });
});
