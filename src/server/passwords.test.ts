import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwords.ts";

describe("passwords", () => {
  it("verifies a matching password and rejects a wrong one", () => {
    const hash = hashPassword("correct-horse");
    expect(hash.startsWith("argon2id$")).toBe(true);
    expect(verifyPassword("correct-horse", hash)).toBe(true);
    expect(verifyPassword("wrong-horse", hash)).toBe(false);
    expect(verifyPassword("correct-horse", "not-a-hash")).toBe(false);
  });
});
