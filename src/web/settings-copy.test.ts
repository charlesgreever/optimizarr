import { describe, expect, it } from "vitest";
import { sizeCapLabel } from "./settings-copy";

describe("settings copy", () => {
  it("names size caps in everyday words", () => {
    expect(sizeCapLabel("movie1080p")).toBe("Movie 1080p");
    expect(sizeCapLabel("movie4kSdr")).toBe("Movie 4K SDR");
    expect(sizeCapLabel("movie4kHdr")).toBe("Movie 4K HDR");
    expect(sizeCapLabel("tv1080p")).toBe("TV 1080p");
    expect(sizeCapLabel("tv4k")).toBe("TV 4K");
  });
});
