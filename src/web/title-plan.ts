export function titleOptimizeLocked(item: {
  mediaState?: "waiting" | "unreadable" | "inspected";
  inspected?: boolean;
  error?: string | null;
}): boolean {
  if (item.mediaState === "unreadable" || item.mediaState === "waiting") return true;
  if (item.error) return true;
  if (item.inspected === false) return true;
  return false;
}

export function canQueueCustomPlan(
  plan: { video?: { kind?: string } } | null,
  errors: string[],
  locked: boolean,
): boolean {
  return Boolean(plan) && errors.length === 0 && !locked;
}
