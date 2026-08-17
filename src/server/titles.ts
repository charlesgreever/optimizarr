export type TitleParts = {
  title: string;
  seriesTitle?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export function seasonLabel(seasonNumber: number | null | undefined): string {
  if (seasonNumber === 0) return "Specials";
  if (seasonNumber == null || Number.isNaN(Number(seasonNumber))) return "Season ?";
  return `Season ${seasonNumber}`;
}

export function displayTitle(item: TitleParts): string {
  const show = item.seriesTitle?.trim();
  if (!show) return item.title;
  return `${show} / ${seasonLabel(item.seasonNumber)} / ${item.title}`;
}

export function episodeCodes(item: TitleParts): string[] {
  const season = item.seasonNumber;
  const episode = item.episodeNumber;
  if (season == null || episode == null || Number.isNaN(season) || Number.isNaN(episode)) return [];
  const s = String(season).padStart(2, "0");
  const e = String(episode).padStart(2, "0");
  return [`s${s}e${e}`, `${season}x${e}`, `${season}x${episode}`];
}

export function matchesTitleSearch(item: TitleParts, q: string, extra: string[] = []): boolean {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [item.title, item.seriesTitle ?? "", displayTitle(item), ...episodeCodes(item), ...extra]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => hay.includes(token));
}
