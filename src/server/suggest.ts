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

export type SuggestionNowAfter = {
  codec: string | null;
  sizeBytes: number | null;
  sizePerHourGb: number | null;
  quality: string | null;
};

export type ExplainedSuggestion = {
  reasons: string[];
  now: SuggestionNowAfter;
  after: SuggestionNowAfter;
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

export function codecLabel(codec: string | null | undefined): string {
  if (!codec) return "unknown codec";
  const c = codec.toLowerCase();
  if (c === "hevc" || c === "h265") return "HEVC";
  if (c === "av1") return "AV1";
  if (c === "h264" || c === "avc") return "H.264";
  return codec;
}

export function isTargetCodec(codec: string | null | undefined, target: Settings["targetCodec"]): boolean {
  if (!codec) return false;
  const c = codec.toLowerCase();
  if (target === "av1") return c === "av1";
  return c === "hevc" || c === "h265";
}

const SIZE_CATEGORIES = new Set<SizeCategory>(["movie1080p", "movie4kSdr", "movie4kHdr", "tv1080p", "tv4k"]);

export function asSuggestionActions(actions: string[]): SuggestionAction[] {
  return actions.filter((action): action is SuggestionAction =>
    action === "transcode" || action === "remux" || action === "add_stereo",
  );
}

export function asSizeCategory(value: string | null | undefined): SizeCategory | null {
  if (value && SIZE_CATEGORIES.has(value as SizeCategory)) return value as SizeCategory;
  return null;
}

export function explainSuggestion(
  input: {
    actions: SuggestionAction[] | string[];
    overCap: boolean;
    extraTracks?: boolean;
    videoCodec: string | null | undefined;
    size: number | null | undefined;
    sizePerHourGb: number | null | undefined;
    estimatedSavingsBytes: number | null | undefined;
    category: SizeCategory | string | null | undefined;
    quality?: string | null;
  },
  settings: Settings,
): ExplainedSuggestion {
  const actions = asSuggestionActions(input.actions);
  const category = asSizeCategory(typeof input.category === "string" ? input.category : null);
  const cap = category ? settings.sizeCapsGbPerHour[category] : null;
  const reasons: string[] = [];
  const changingCodec = actions.includes("transcode") && !isTargetCodec(input.videoCodec, settings.targetCodec);

  if (changingCodec) {
    reasons.push(`Video is ${codecLabel(input.videoCodec)}. Convert to ${codecLabel(settings.targetCodec)}.`);
  }
  if (input.overCap && input.sizePerHourGb != null && cap != null) {
    reasons.push(
      `Over the size cap: ${input.sizePerHourGb.toFixed(2)} GB/hr now, ${cap.toFixed(2)} GB/hr allowed.`,
    );
  }
  if (actions.includes("remux") && input.extraTracks) {
    reasons.push("Keep the video; drop extra audio and subtitle tracks.");
  }
  if (actions.includes("add_stereo")) {
    reasons.push("Add a stereo AAC track.");
  }

  const afterCodec = actions.includes("transcode") ? settings.targetCodec : (input.videoCodec ?? null);
  const afterSize =
    input.estimatedSavingsBytes != null && input.size
      ? Math.max(0, input.size - input.estimatedSavingsBytes)
      : null;
  const afterHour = input.overCap && cap != null ? cap : null;

  return {
    reasons,
    now: {
      codec: input.videoCodec ?? null,
      sizeBytes: input.size ?? null,
      sizePerHourGb: input.sizePerHourGb ?? null,
      quality: input.quality ?? null,
    },
    after: {
      codec: afterCodec,
      sizeBytes: afterSize,
      sizePerHourGb: afterHour,
      quality: null,
    },
  };
}
