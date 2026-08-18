export async function keepSelected(
  reviewIds: number[],
  keep: (reviewId: number) => Promise<unknown>,
): Promise<{
  acceptedIds: number[];
  failures: Array<{ reviewId: number; error: string }>;
}> {
  const results = await Promise.allSettled(reviewIds.map((reviewId) => keep(reviewId)));
  const acceptedIds: number[] = [];
  const failures: Array<{ reviewId: number; error: string }> = [];
  results.forEach((result, index) => {
    const reviewId = reviewIds[index];
    if (result.status === "fulfilled") acceptedIds.push(reviewId);
    else failures.push({
      reviewId,
      error: result.reason instanceof Error ? result.reason.message : "Could not start Keep.",
    });
  });
  return { acceptedIds, failures };
}

export type SelectableReviewStatus = "pending" | "keeping";

export function pendingReviewIds(reviews: Array<{ id: number; status?: SelectableReviewStatus }>): number[] {
  return reviews.filter((review) => review.status !== "keeping").map((review) => review.id);
}

export function selectedPendingReviewIds(
  reviews: Array<{ id: number; status?: SelectableReviewStatus }>,
  selected: Record<number, boolean>,
): number[] {
  return pendingReviewIds(reviews).filter((reviewId) => selected[reviewId]);
}
