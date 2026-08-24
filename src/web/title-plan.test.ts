import { describe, expect, it } from "vitest";
import { canQueueCustomPlan, titleOptimizeLocked } from "./title-plan";

describe("title plan gating", () => {
  it("locks unreadable and uninspected titles and waits for a previewed plan", () => {
    expect(titleOptimizeLocked({ mediaState: "unreadable", error: "Path is unreadable." })).toBe(true);
    expect(titleOptimizeLocked({ mediaState: "waiting", inspected: false })).toBe(true);
    expect(titleOptimizeLocked({ mediaState: "inspected", inspected: true, error: null })).toBe(false);
    expect(canQueueCustomPlan(null, [], false)).toBe(false);
    expect(canQueueCustomPlan({ video: { kind: "size" } }, [], false)).toBe(true);
    expect(canQueueCustomPlan({ video: { kind: "copy" } }, ["Do nothing"], false)).toBe(false);
  });
});
