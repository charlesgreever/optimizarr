import type { LibraryItem } from "./types.ts";

export function displayTitle(item: Pick<LibraryItem, "type" | "title" | "showTitle" | "season" | "episode" | "episodeTitle">): string {
  if (item.type === "episode") {
    const show = item.showTitle || item.title;
    const season = String(item.season ?? 0).padStart(2, "0");
    const episode = String(item.episode ?? 0).padStart(2, "0");
    const name = item.episodeTitle || item.title;
    return `${show} S${season}E${episode} · ${name}`;
  }
  return item.title;
}

export function seriesGroupKey(item: Pick<LibraryItem, "instanceId" | "showTitle" | "title">): string {
  return `${item.instanceId}::${item.showTitle || item.title}`;
}

export function matchesTitleSearch(query: string, item: LibraryItem): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    item.title,
    item.showTitle ?? "",
    item.episodeTitle ?? "",
    displayTitle(item),
    item.quality,
    item.instanceName,
    seasonEpisodeTokens(item),
  ]
    .join(" ")
    .toLowerCase();
  return tokenize(q).every((token) => hay.includes(token) || hay.includes(normalizeEpisodeToken(token)));
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeEpisodeToken);
}

export function normalizeEpisodeToken(token: string): string {
  const compact = token.replace(/^s(\d+)e(\d+)$/i, (_, s, e) => `s${s.padStart(2, "0")}e${e.padStart(2, "0")}`);
  const alt = token.match(/^(\d+)x(\d+)$/i);
  if (alt) return `s${alt[1].padStart(2, "0")}e${alt[2].padStart(2, "0")}`;
  return compact;
}

function seasonEpisodeTokens(item: LibraryItem): string {
  if (item.type !== "episode") return "";
  const s = String(item.season ?? 0).padStart(2, "0");
  const e = String(item.episode ?? 0).padStart(2, "0");
  return `S${s}E${e} ${Number(s)}x${Number(e)}`;
}
