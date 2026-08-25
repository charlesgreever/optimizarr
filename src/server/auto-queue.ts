import type { LibraryItem, Settings, Suggestion } from "./types.ts";

export function shouldQueueNewImport(input: {
  settings: Settings;
  item: Pick<LibraryItem, "firstSeenAt" | "fileChangedAt">;
  suggestion: Suggestion | null;
}): boolean {
  const { settings, item, suggestion } = input;
  if (!settings.suggestionDefaults.queueNewImports) return false;
  if (settings.queueNewImportsSince <= 0) return false;
  if (!settings.languageConfirmed || !settings.reviewPath.trim()) return false;
  if (!suggestion) return false;
  if (suggestion.actions.includes("search_language") && suggestion.actions.every((action) => action === "search_language")) {
    return false;
  }
  const since = settings.queueNewImportsSince;
  return (item.firstSeenAt ?? 0) >= since || (item.fileChangedAt ?? 0) >= since;
}
