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

export function matchesTitleSearch(item: TitleParts, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [item.title, item.seriesTitle ?? "", displayTitle(item)].join(" ").toLowerCase();
  return hay.includes(needle);
}
