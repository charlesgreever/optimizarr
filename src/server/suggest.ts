import type {
  InspectionReport,
  LibraryItem,
  Settings,
  SizeCategory,
  Suggestion,
  SuggestionAction,
  VideoTarget,
} from "./types.ts";
import { normalizeLang } from "./inspect.ts";

export type SuggestInput = {
  item: LibraryItem;
  report: InspectionReport;
  settings: Settings;
  sizeExempt: boolean;
  excluded: boolean;
  forceTranscode?: boolean;
  forceStereo?: boolean;
  videoTarget: VideoTarget;
  av1Available: boolean;
};

export function sizeCategory(item: LibraryItem, report: InspectionReport): SizeCategory {
  const isTv = item.type === "episode";
  const fourK = is4k(item, report);
  const hdr = report.hdr !== "none" || /hdr|dolby|dv/i.test(`${item.quality} ${item.resolution}`);
  if (isTv) return fourK ? "tv4k" : "tv1080p";
  if (fourK) return hdr ? "movie4kHdr" : "movie4kSdr";
  return "movie1080p";
}

export function is4k(item: LibraryItem, report: InspectionReport): boolean {
  const label = `${item.quality} ${item.resolution}`.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(label)) return true;
  return report.height >= 2160 || report.width >= 3840;
}

export function buildSuggestion(input: SuggestInput): Suggestion | null {
  if (input.excluded) return null;
  if (input.report.listingState === "iso_unlisted") return null;
  const { item, report, settings } = input;
  const category = sizeCategory(item, report);
  const cap = settings.sizeCaps[category];
  const overCap = report.sizePerHourGb > cap + 0.01;
  const lang = normalizeLang(settings.preferredLanguage);
  const keepAudio = report.audio.filter((t) => shouldKeepAudio(t, lang, report.audio.length));
  const stripAudio = report.audio.filter((t) => !keepAudio.includes(t));
  const keepSubs = report.subtitles.filter((t) => t.language === lang || (t.untagged && report.subtitles.length === 1));
  const stripSubs = report.subtitles.filter((t) => !keepSubs.includes(t));
  const extraTracks = stripAudio.length + stripSubs.length > 0;
  const alreadyStereo = report.audio.some((t) => t.channels <= 2 && (t.language === lang || t.language === "und"));
  const layoutNeedsStereo = report.audio.some((t) => t.channels > 6 || /atmos|truehd|eac3/i.test(`${t.codec} ${t.title}`));
  const addStereo = (input.forceStereo || layoutNeedsStereo) && !alreadyStereo;
  const codec = report.videoCodec.toLowerCase();
  const alreadyAv1 = codec.includes("av1");
  const inefficient = !alreadyAv1 && !/hevc|h265|av1/.test(codec);
  const target: VideoTarget = input.videoTarget === "av1" && input.av1Available ? "av1" : "hevc";
  const transcode =
    !alreadyAv1 &&
    !input.sizeExempt &&
    (input.forceTranscode || (overCap && (inefficient || /hevc|h265/.test(codec))));

  const actions: SuggestionAction[] = [];
  if (transcode) actions.push("transcode");
  if (extraTracks) actions.push("tracks");
  if (addStereo) actions.push("add_stereo");
  if (actions.length === 0) return null;

  const reasons: string[] = [];
  if (transcode && overCap) {
    reasons.push(`Over the size cap: ${report.sizePerHourGb.toFixed(2)} GB/hr now, ${cap.toFixed(2)} GB/hr allowed.`);
  } else if (transcode && input.forceTranscode) {
    reasons.push(`Re-encode to ${target.toUpperCase()} because you asked to force this title.`);
  }
  if (extraTracks) reasons.push("Drop extra audio and subtitle tracks that are not in your preferred language.");
  if (addStereo) reasons.push("Add an AAC stereo track so a TV can play dialogue without surround.");

  let warning: string | null = null;
  if (transcode && (report.hdr === "dolby_vision" || report.hdr === "hdr10plus")) {
    warning = "Dolby Vision or HDR10+ metadata may be lost when this file is re-encoded.";
  }

  const afterCodec = transcode ? target.toUpperCase() : report.videoCodec;
  const estimated = transcode && overCap ? Math.max(0, report.sizeBytes - Math.round(cap * (report.durationSec / 3600) * 1024 ** 3)) : null;

  return {
    id: "",
    itemId: item.id,
    actions,
    reasons,
    warning,
    category,
    estimatedSavingsBytes: estimated,
    now: {
      codec: report.videoCodec,
      quality: item.quality || null,
      sizeBytes: report.sizeBytes,
      sizePerHourGb: report.sizePerHourGb,
    },
    after: {
      codec: afterCodec,
      quality: null,
      sizeBytes: transcode ? (estimated != null ? report.sizeBytes - estimated : null) : null,
      sizePerHourGb: transcode ? cap : null,
    },
    dismissed: false,
    keepAudio: keepAudio.map((t) => t.index),
    stripAudio: stripAudio.map((t) => t.index),
    keepSubs: keepSubs.map((t) => t.index),
    stripSubs: stripSubs.map((t) => t.index),
  };
}

function shouldKeepAudio(
  track: InspectionReport["audio"][number],
  lang: string,
  audioCount: number,
): boolean {
  if (track.language === lang) return true;
  if (track.untagged && audioCount === 1) return true;
  return false;
}
