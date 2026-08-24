import { describe, expect, it } from "vitest";
import { inspectBannerView } from "./inspect-banner";

describe("inspect banner", () => {
  it("shows a dismissible Errors link after the walk when files failed", () => {
    expect(inspectBannerView({ walking: false, pending: 0, inspected: 10, failed: 3 }, false)).toMatchObject({
      inspecting: false,
      showFailed: true,
      failed: 3,
    });
    expect(inspectBannerView({ walking: false, pending: 0, inspected: 10, failed: 3 }, true).showFailed).toBe(false);
    expect(inspectBannerView({ walking: true, pending: 4, inspected: 1, failed: 2 }, false).inspecting).toBe(true);
  });
});
