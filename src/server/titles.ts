import type { LibraryItem } from "./types.ts";

type TitleFields = Pick<LibraryItem, "type" | "title" | "showTitle" | "season" | "episode" | "episodeTitle">;
type SharedFileFields = Pick<LibraryItem, "id" | "type" | "season" | "episode">;

export function displayTitle(item: TitleFields): string {
  if (item.type === "episode") {
    const show = item.showTitle || item.title;
    const name = item.episodeTitle || item.title;
    return `${show} ${episodeCode(item, true)} · ${name}`;
  }
  return item.title;
}

export function displayTitleForFile(items: TitleFields[]): string {
  const sorted = [...items].sort(compareEpisodeOrder);
  if (sorted.length === 0) return "";
  const episodes = sorted.filter((item) => item.type === "episode");
  if (episodes.length <= 1) return displayTitle(sorted[0]!);
  const first = episodes[0]!;
  const show = first.showTitle || first.title;
  const name = first.episodeTitle || first.title;
  return `${show} ${episodeRange(episodes)} · ${name}`;
}

export function sharedFileLabel(item: SharedFileFields, siblings: SharedFileFields[]): string | null {
  const others = siblings.filter((row) => row.id !== item.id && row.type === "episode").sort(compareEpisodeOrder);
  if (others.length === 0) return null;
  const sameSeason = others.every((row) => row.season === item.season);
  return `Same file as ${others.map((row) => episodeCode(row, !sameSeason)).join(", ")}`;
}

function compareEpisodeOrder(a: Pick<LibraryItem, "season" | "episode">, b: Pick<LibraryItem, "season" | "episode">): number {
  return (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0);
}

function episodeCode(item: Pick<LibraryItem, "season" | "episode">, includeSeason: boolean): string {
  const episode = `E${String(item.episode ?? 0).padStart(2, "0")}`;
  if (!includeSeason) return episode;
  return `S${String(item.season ?? 0).padStart(2, "0")}${episode}`;
}

function episodeRange(episodes: Array<Pick<LibraryItem, "season" | "episode">>): string {
  const first = episodes[0]!;
  const last = episodes[episodes.length - 1]!;
  const nums = episodes.map((item) => item.episode ?? 0);
  const sameSeason = episodes.every((item) => item.season === first.season);
  if (sameSeason && isContiguous(nums)) {
    return `S${String(first.season ?? 0).padStart(2, "0")}E${String(nums[0]).padStart(2, "0")}–E${String(last.episode ?? 0).padStart(2, "0")}`;
  }
  if (sameSeason) {
    return `S${String(first.season ?? 0).padStart(2, "0")}${nums.map((n) => `E${String(n).padStart(2, "0")}`).join("&")}`;
  }
  return episodes.map((item) => episodeCode(item, true)).join("&");
}

function isContiguous(nums: number[]): boolean {
  return nums.every((value, index) => index === 0 || value === nums[index - 1]! + 1);
}

export function seriesGroupKey(item: Pick<LibraryItem, "instanceId" | "arrSeriesId" | "showTitle" | "title">): string {
  if (item.arrSeriesId != null) return `${item.instanceId}::series:${item.arrSeriesId}`;
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
