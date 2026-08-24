import { describe, expect, it } from "vitest";
import { keepAllConfirmCopy, keepStartedCopy } from "./Review.tsx";

describe("Keep all copy", () => {
  it("names the file count and that library files will be replaced", () => {
    expect(keepAllConfirmCopy(3)).toBe("Keep all 3 files? This replaces each library file with its new copy.");
    expect(keepAllConfirmCopy(1)).toBe("Keep all 1 file? This replaces each library file with its new copy.");
  });

  it("names accepted and skipped Keep counts", () => {
    expect(keepStartedCopy(3, 0)).toBe("Keep started for 3.");
    expect(keepStartedCopy(2, 1)).toBe("Keep started for 2; skipped 1.");
  });
});
