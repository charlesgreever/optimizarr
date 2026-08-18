import { describe, expect, it, vi } from "vitest";
import { keepSelected, selectedPendingReviewIds } from "./keep-selected";

describe("keepSelected", () => {
  it("accepts two pending reviews without starting a third review that is already keeping", async () => {
    const keep = vi.fn(async () => undefined);
    const reviewIds = selectedPendingReviewIds(
      [
        { id: 1, status: "pending" },
        { id: 2, status: "pending" },
        { id: 3, status: "keeping" },
      ],
      { 1: true, 2: true, 3: true },
    );

    await expect(keepSelected(reviewIds, keep)).resolves.toEqual({
      acceptedIds: [1, 2],
      failures: [],
    });
    expect(keep.mock.calls.map(([id]) => id)).toEqual([1, 2]);
  });

  it("keeps a rejected request attached to its review card", async () => {
    const keep = vi.fn(async (id: number) => {
      if (id === 2) throw new Error("Sidecar is gone");
    });

    await expect(keepSelected([1, 2], keep)).resolves.toEqual({
      acceptedIds: [1],
      failures: [{ reviewId: 2, error: "Sidecar is gone" }],
    });
  });

  it("does nothing when no reviews are selected", async () => {
    const keep = vi.fn(async () => undefined);

    await expect(keepSelected([], keep)).resolves.toEqual({ acceptedIds: [], failures: [] });
    expect(keep).not.toHaveBeenCalled();
  });
});
