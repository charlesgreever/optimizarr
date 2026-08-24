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

export const audioActionSelectClass = "h-10 w-56 max-w-full shrink-0";
export const audioChannelSelectClass = "h-10 w-24 shrink-0";

export function canQueueCustomPlan(
  plan: { video?: { kind?: string } } | null,
  errors: string[],
  locked: boolean,
): boolean {
  return Boolean(plan) && errors.length === 0 && !locked;
}
