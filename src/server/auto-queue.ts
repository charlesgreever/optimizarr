import type { LibraryItem, Settings, Suggestion } from "./types.ts";

export function shouldQueueNewImport(input: {
  settings: Settings;
  item: Pick<LibraryItem, "fileChangedAt" | "sizeBytes" | "keptSizeBytes">;
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
  const kept = item.keptSizeBytes ?? 0;
  if (kept > 0 && item.sizeBytes === kept) return false;
  return (item.fileChangedAt ?? 0) >= settings.queueNewImportsSince;
}
