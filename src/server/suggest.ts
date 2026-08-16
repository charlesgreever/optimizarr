import { sizeCategory, sizePerHourGb, type InspectionReport, type SizeCategory } from "./inspect.ts";
import type { Settings } from "./types.ts";

export type SuggestionAction = "transcode" | "remux" | "add_stereo";

export type SuggestionPlan = {
  actions: SuggestionAction[];
  warning: string | null;
  estimatedSavingsBytes: number | null;
  overCap: boolean;
  extraTracks: boolean;
  category: SizeCategory;
  sizePerHourGb: number | null;
  keepAudio: string[];
  stripAudio: string[];
  keepSubs: string[];
  stripSubs: string[];
  healthy: boolean;
};

const UNTAGGED = new Set(["", "und", "unk", "unknown"]);

export function isPreferredLang(lang: string | undefined, preferred: string): boolean {
  if (!lang) return false;
  const l = lang.toLowerCase();
  const p = preferred.toLowerCase();
  if (UNTAGGED.has(l)) return false;
  return l === p || l.startsWith(p) || p.startsWith(l);
}

export function isUntagged(lang: string | undefined): boolean {
  return !lang || UNTAGGED.has(lang.toLowerCase());
}

export function buildSuggestion(
  report: InspectionReport,
  settings: Settings,
  itemType: "movie" | "episode",
  opts?: { force?: boolean; addStereo?: boolean },
): SuggestionPlan {
  const preferred = settings.preferredLanguage;
  const category = sizeCategory(itemType, report);
  const sph = sizePerHourGb(report);
  const cap = settings.sizeCapsGbPerHour[category];
  const overCap = sph !== null && sph > cap;

  const keepAudio: string[] = [];
  const stripAudio: string[] = [];
  for (const a of report.audio) {
    const label = a.language ?? "und";
    if (isPreferredLang(a.language, preferred)) keepAudio.push(label);
    else stripAudio.push(label);
  }
  const keepSubs: string[] = [];
  const stripSubs: string[] = [];
  for (const s of report.subtitles) {
    const label = s.language ?? "und";
    if (isPreferredLang(s.language, preferred)) keepSubs.push(label);
    else stripSubs.push(label);
  }
  const extraTracks = stripAudio.length + stripSubs.length > 0;
  const hasStereo = report.audio.some((a) => (a.channels ?? 0) > 0 && (a.channels ?? 0) <= 2);
  const complexSurround = report.audio.some((a) => a.atmos || (a.channels ?? 0) > 6);

  const codec = report.videoCodec;
  const actions: SuggestionAction[] = [];
  let warning: string | null = null;

  if (codec === "av1") {
    if (extraTracks) actions.push("remux");
  } else if (codec === "hevc") {
    if (overCap) {
      actions.push("transcode");
    } else if (extraTracks) {
      actions.push("remux");
    }
  } else {
    actions.push("transcode");
    if (extraTracks) actions.push("remux");
  }

  if (actions.includes("transcode") && (report.hdr === "dolby_vision" || report.hdr === "hdr10plus")) {
    warning = "Dolby Vision / HDR10+ metadata may be lost in a hardware transcode.";
  }

  if (!hasStereo && (opts?.addStereo || complexSurround) && !actions.includes("add_stereo")) {
    actions.push("add_stereo");
  }
  if (opts?.force && actions.length === 0) {
    actions.push(codec === "h264" ? "transcode" : "remux");
  }

  let estimatedSavingsBytes: number | null = null;
  if (overCap && sph && report.durationSec > 0) {
    const targetBytes = cap * 1024 ** 3 * (report.durationSec / 3600);
    estimatedSavingsBytes = Math.max(0, Math.round(report.sizeBytes - targetBytes));
  }

  const healthy = actions.length === 0 && !opts?.force;
  return {
    actions,
    warning,
    estimatedSavingsBytes,
    overCap,
    extraTracks,
    category,
    sizePerHourGb: sph,
    keepAudio,
    stripAudio,
    keepSubs,
    stripSubs,
    healthy,
  };
}
