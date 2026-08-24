export function titleOptimizeLocked(item: {
  mediaState?: "waiting" | "unreadable" | "inspected";
  inspected?: boolean;
  error?: string | null;
  path?: string;
}): boolean {
  const iso = (item.path ?? "").toLowerCase().endsWith(".iso");
  if (iso) return false;
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

export function canIdentifyLanguage(track: { language?: string; untagged?: boolean; channels?: number } | undefined, available: boolean, locked: boolean): boolean {
  if (!available || locked || !track) return false;
  if ((track.channels ?? 0) <= 0) return false;
  return track.untagged === true || track.language === "und";
}

const TEXT_SUBTITLE_CODECS = new Set([
  "mov_text",
  "eia_608",
  "eia_608_closed_captions",
  "webvtt",
  "subrip",
  "srt",
  "ass",
  "ssa",
  "text",
  "ttxt",
]);

export function canIdentifySubtitle(track: { language?: string; untagged?: boolean; codec?: string } | undefined, locked: boolean): boolean {
  if (locked || !track) return false;
  if (track.untagged !== true && track.language !== "und") return false;
  return TEXT_SUBTITLE_CODECS.has((track.codec ?? "").toLowerCase().replace(/-/g, "_"));
}

export function isImageSubtitle(codec: string | undefined): boolean {
  const name = (codec ?? "").toLowerCase();
  return name.includes("pgs") || name.includes("dvd_subtitle") || name.includes("dvb_subtitle") || name.includes("xsub") || name.includes("vobsub");
}

export function formatClipClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function parseClipClock(value: string): number | null {
  const trimmed = value.trim();
  const clock = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Math.floor(Number(trimmed));
}
