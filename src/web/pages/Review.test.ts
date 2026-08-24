import { describe, expect, it } from "vitest";
import { keepAllConfirmCopy } from "./Review.tsx";

describe("Keep all copy", () => {
  it("names the file count and that library files will be replaced", () => {
    expect(keepAllConfirmCopy(3)).toBe("Keep all 3 files? This replaces each library file with its new copy.");
    expect(keepAllConfirmCopy(1)).toBe("Keep all 1 file? This replaces each library file with its new copy.");
  });
});
