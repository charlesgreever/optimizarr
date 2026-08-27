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
import { exceedsSizeCap } from "./size-budget.ts";
import { soleNonPreferredAudio } from "./arr-search.ts";

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
  hardwareAvailable?: boolean;
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
  if (input.report.listingState === "iso_unlisted" && !input.settings.suggestionDefaults.convertIsoToMkv) return null;
  const { item, report, settings } = input;
  const category = sizeCategory(item, report);
  const cap = settings.sizeCaps[category];
  const overCap = exceedsSizeCap(report.sizePerHourGb, cap);
  const lang = normalizeLang(settings.preferredLanguage);
  const onlyWrongLanguage = soleNonPreferredAudio(report.audio, lang);
  const keepAudio = onlyWrongLanguage
    ? report.audio.filter((track) => track.channels > 0)
    : settings.suggestionDefaults.removeNonPreferredAudio
      ? report.audio.filter((t) => shouldKeepAudio(t, lang, report.audio.length))
      : report.audio;
  const stripAudio = report.audio.filter((t) => !keepAudio.includes(t));
  const keepSubs = settings.suggestionDefaults.removeNonPreferredSubtitles
    ? report.subtitles.filter((t) => t.language === lang || (t.untagged && report.subtitles.length === 1))
    : report.subtitles;
  const stripSubs = report.subtitles.filter((t) => !keepSubs.includes(t));
  const extraTracks = stripAudio.length + stripSubs.length > 0;
  const alreadyStereo = report.audio.some((t) => t.channels <= 2 && (t.language === lang || t.language === "und"));
  const layoutNeedsStereo = report.audio.some((t) => t.channels > 6 || /atmos|truehd|eac3/i.test(`${t.codec} ${t.title}`));
  const addStereo = (input.forceStereo || (settings.suggestionDefaults.addStereo && layoutNeedsStereo)) && !alreadyStereo;
  const codec = report.videoCodec.toLowerCase();
  const alreadyAv1 = codec.includes("av1");
  const belowHevc = !codecIsAtLeastHevc(report.videoCodec);
  const target: VideoTarget = input.videoTarget === "av1" && input.av1Available ? "av1" : "hevc";
  const transcodeForCap = settings.suggestionDefaults.transcodeToSizeCap && overCap && (belowHevc || /hevc|h265/.test(codec));
  const transcodeForCodec = settings.suggestionDefaults.transcodeBelowHevc && belowHevc;
  const transcode =
    !alreadyAv1 &&
    !input.sizeExempt &&
    (input.forceTranscode || transcodeForCap || transcodeForCodec);
  const remux = (settings.suggestionDefaults.convertMp4ToMkv && /\.mp4$/i.test(item.path))
    || (settings.suggestionDefaults.convertIsoToMkv && /\.iso$/i.test(item.path));

  const actions: SuggestionAction[] = [];
  if (transcode) actions.push("transcode");
  if (remux) actions.push("remux");
  if (extraTracks) actions.push("tracks");
  if (addStereo) actions.push("add_stereo");
  const searchLanguage = settings.suggestionDefaults.searchPreferredLanguage && onlyWrongLanguage;
  if (searchLanguage && actions.length === 0) actions.push("search_language");
  if (actions.length === 0) return null;

  const reasons: string[] = [];
  if (transcode && overCap) {
    reasons.push(`Over the size cap: ${report.sizePerHourGb.toFixed(2)} GB/hr now, ${cap.toFixed(2)} GB/hr allowed.`);
  }
  if (transcode && transcodeForCodec) {
    reasons.push(`This video is ${codecLabel(report.videoCodec)}. Re-encode to ${target.toUpperCase()}.`);
  } else if (transcode && input.forceTranscode && !overCap) {
    reasons.push(`Re-encode to ${target.toUpperCase()} because you asked to force this title.`);
  }
  if (remux && /\.iso$/i.test(item.path)) reasons.push("Convert the disc image to MKV.");
  else if (remux) reasons.push("Convert the MP4 container to MKV before any video encode.");
  if (stripAudio.length) reasons.push("Drop audio tracks that are not in your preferred language.");
  if (stripSubs.length) reasons.push("Drop subtitle tracks that are not in your preferred language.");
  if (addStereo) reasons.push("Add an AAC stereo track so a TV can play dialogue without surround.");
  if (searchLanguage) reasons.push("The only audio track is not in your preferred language.");

  const warnings: string[] = [];
  if (transcode && input.hardwareAvailable === false) {
    warnings.push("Hardware encode is unavailable. This transcode will fail until CUDA or VAAPI is available.");
  }
  if (transcode && (report.hdr === "dolby_vision" || report.hdr === "hdr10plus")) {
    warnings.push("Dolby Vision or HDR10+ metadata may be lost when this file is re-encoded.");
  }
  const warning = warnings.length > 0 ? warnings.join(" ") : null;

  const afterCodec = transcode ? target.toUpperCase() : report.videoCodec;
  const encodeGbPerHour = transcode ? Math.min(report.sizePerHourGb, cap) : null;
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
      sizePerHourGb: encodeGbPerHour,
    },
    dismissed: false,
    keepAudio: keepAudio.map((t) => t.index),
    stripAudio: stripAudio.map((t) => t.index),
    keepSubs: keepSubs.map((t) => t.index),
    stripSubs: stripSubs.map((t) => t.index),
  };
}

export function codecIsAtLeastHevc(codec: string): boolean {
  return /hevc|h265|av1/i.test(codec);
}

export function codecLabel(codec: string): string {
  const value = codec.toLowerCase();
  if (/h264|avc/.test(value)) return "H.264";
  if (/mpeg2/.test(value)) return "MPEG-2";
  if (/vc1|wmv3/.test(value)) return "VC-1";
  if (/mpeg4|xvid|divx/.test(value)) return "MPEG-4";
  if (/vp8/.test(value)) return "VP8";
  if (/vp9/.test(value)) return "VP9";
  return codec || "unknown video";
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
