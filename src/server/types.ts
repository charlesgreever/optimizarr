export type ArrKind = "radarr" | "sonarr";
export type PlayerKind = "plex" | "jellyfin";
export type MediaType = "movie" | "episode";
export type JobStatus = "queued" | "held" | "paused" | "running" | "succeeded" | "failed" | "cancelled";
export type JobPhase =
  | "queued"
  | "held"
  | "paused"
  | "copying"
  | "muxing"
  | "creating_stereo"
  | "transcoding"
  | "finishing"
  | "idle";
export type ReviewStatus = "pending" | "keeping" | "discarding";
export type SizeCategory = "movie1080p" | "movie4kSdr" | "movie4kHdr" | "tv1080p" | "tv4k";
export type SuggestionAction = "transcode" | "tracks" | "add_stereo";
export type VideoTarget = "hevc" | "av1";
export type HardwareBackend = "cuda" | "vaapi" | "none";
export type ActivityOutcome = "kept" | "discarded" | "flagged" | "failed" | "cancelled";
export type ExclusionKind = "path" | "profile" | "tag" | "title";

export type SizeCaps = {
  movie1080p: number;
  movie4kSdr: number;
  movie4kHdr: number;
  tv1080p: number;
  tv4k: number;
};

export const DEFAULT_SIZE_CAPS: SizeCaps = {
  movie1080p: 2.5,
  movie4kSdr: 6,
  movie4kHdr: 8,
  tv1080p: 1.0,
  tv4k: 4.0,
};

export type Settings = {
  preferredLanguage: string;
  languageConfirmed: boolean;
  reviewPath: string;
  sizeCaps: SizeCaps;
  videoTarget: VideoTarget;
  concurrency: number;
  conservativeMode: boolean;
  offPeakEnabled: boolean;
  offPeakStart: string;
  offPeakEnd: string;
  localAuthBypass: boolean;
  inspectConcurrency: number;
  writeMode: WriteMode;
};

export const DEFAULT_SETTINGS: Settings = {
  preferredLanguage: "eng",
  languageConfirmed: false,
  reviewPath: "",
  sizeCaps: { ...DEFAULT_SIZE_CAPS },
  videoTarget: "hevc",
  concurrency: 1,
  conservativeMode: false,
  offPeakEnabled: false,
  offPeakStart: "01:00",
  offPeakEnd: "07:00",
  localAuthBypass: false,
  inspectConcurrency: 1,
  writeMode: "sidecar",
};

export type ArrInstance = {
  id: string;
  kind: ArrKind;
  name: string;
  url: string;
  enabled: boolean;
  hasApiKey: boolean;
};

export type PlayerInstance = {
  id: string;
  kind: PlayerKind;
  name: string;
  url: string;
  enabled: boolean;
  hasToken: boolean;
};

export type AudioTrack = {
  index: number;
  language: string;
  channels: number;
  codec: string;
  title: string;
  untagged: boolean;
  commentary: boolean;
};

export type SubtitleTrack = {
  index: number;
  language: string;
  codec: string;
  title: string;
  untagged: boolean;
  forced: boolean;
  sdh: boolean;
};

export type InspectionReport = {
  sourceSig: string;
  sourceMethod: "ffprobe" | "iso_ffmpeg";
  listingState: "complete" | "iso_unlisted";
  durationSec: number;
  sizeBytes: number;
  sizePerHourGb: number;
  videoCodec: string;
  width: number;
  height: number;
  bitDepth: number;
  hdr: "none" | "hdr10" | "hdr10plus" | "dolby_vision";
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
  hasChapters: boolean;
  hasAttachments: boolean;
};

export type SuggestionNowAfter = {
  codec: string | null;
  quality: string | null;
  sizeBytes: number | null;
  sizePerHourGb: number | null;
};

export type Suggestion = {
  id: string;
  itemId: string;
  actions: SuggestionAction[];
  reasons: string[];
  warning: string | null;
  category: SizeCategory;
  estimatedSavingsBytes: number | null;
  now: SuggestionNowAfter;
  after: SuggestionNowAfter;
  dismissed: boolean;
  keepAudio: number[];
  stripAudio: number[];
  keepSubs: number[];
  stripSubs: number[];
};

export type LibraryItem = {
  id: string;
  instanceId: string;
  instanceName: string;
  arrId: number;
  type: MediaType;
  title: string;
  showTitle: string | null;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
  path: string;
  sizeBytes: number;
  quality: string;
  resolution: string;
  profile: string;
  tags: string[];
  posterRemoteUrl: string | null;
  hasPoster: boolean;
  sizeExempt: boolean;
};

export type FileError = {
  itemId: string | null;
  path: string;
  fileName: string;
  displayTitle: string;
  reason: string;
};

export type Job = {
  id: string;
  itemId: string;
  suggestionId: string | null;
  displayTitle: string;
  status: JobStatus;
  phase: JobPhase;
  progress: number;
  error: string | null;
  warning: string | null;
  runNow: boolean;
  createdAt: number;
  writeMode: WriteMode;
  promoteError: string | null;
};

export type ReviewItem = {
  id: string;
  jobId: string;
  itemId: string;
  displayTitle: string;
  status: ReviewStatus;
  flagged: boolean;
  flagReason: string | null;
  sourcePath: string;
  sidecarPath: string;
  source: SuggestionNowAfter & { durationSec: number; tracks: string };
  sidecar: SuggestionNowAfter & { durationSec: number; tracks: string };
  error: string | null;
};

export type HistoryRow = {
  id: string;
  itemId: string;
  displayTitle: string;
  outcome: ActivityOutcome;
  bytesSaved: number;
  createdAt: number;
};

export type HardwareInfo = {
  backend: HardwareBackend;
  cuda: boolean;
  vaapi: boolean;
  av1: boolean;
  reason: string | null;
};

export type HomePayload = {
  filesOptimized: number;
  spaceSavedBytes: number;
  suggestions: number;
  queued: number;
  review: number;
  errors: number;
  recent: HistoryRow[];
  status: string;
};

export type WidgetPayload = {
  status: string;
  queued: number;
  review: number;
  suggestions: number;
  failed: number;
  runningTitle: string | null;
  runningPhase: JobPhase | null;
  runningProgress: number | null;
};

export type SearchHit = {
  itemId: string;
  type: MediaType;
  displayTitle: string;
  instanceName: string;
  href: string;
};

export type PlanOrigin = "bulk" | "custom";
export type WriteMode = "sidecar" | "direct";
export type OutputContainer = "mkv";

export type VideoCopy = { kind: "copy" };
export type VideoSizeTranscode = {
  kind: "size";
  codec: VideoTarget;
  targetBytes: number;
  downscale1080p: boolean;
  bitDepth: number;
};
export type VideoQualityTranscode = {
  kind: "quality";
  codec: VideoTarget;
  quality: number;
  downscale1080p: boolean;
  bitDepth: number;
};
export type VideoIntent = VideoCopy | VideoSizeTranscode | VideoQualityTranscode;

export type AudioKeep = { op: "keep"; index: number };
export type AudioRemove = { op: "remove"; index: number };
export type AudioReplaceAac = { op: "replace_aac"; index: number };
export type AudioReplaceDownmix = { op: "replace_downmix"; index: number; channels: number };
export type AudioAddDownmix = { op: "add_downmix"; index: number; channels: number };
export type AudioOp = AudioKeep | AudioRemove | AudioReplaceAac | AudioReplaceDownmix | AudioAddDownmix;

export type SubtitleKeep = { op: "keep"; index: number };
export type SubtitleRemove = { op: "remove"; index: number };
export type SubtitleOp = SubtitleKeep | SubtitleRemove;

export type ExecutablePlan = {
  origin: PlanOrigin;
  video: VideoIntent;
  audio: AudioOp[];
  subtitles: SubtitleOp[];
  container: OutputContainer;
  writeMode: WriteMode;
  warning: string | null;
  reasons: string[];
  estimatedOutputBytes: number | null;
  category: SizeCategory;
};

export function planHasVideoTranscode(plan: ExecutablePlan): boolean {
  return plan.video.kind !== "copy";
}
