export type SizeCaps = {
  movie1080p: number;
  movie4kSdr: number;
  movie4kHdr: number;
  tv1080p: number;
  tv4k: number;
};

export type Settings = {
  preferredLanguage: string;
  languageConfirmed: boolean;
  localAuthBypass: boolean;
  targetCodec: "hevc" | "av1";
  concurrency: number;
  multiSegment: boolean;
  offPeakEnabled: boolean;
  offPeakStart: string;
  offPeakEnd: string;
  workOnNas: boolean;
  localCopy: boolean;
  autoOptimize: boolean;
  reviewPath: string;
  sizeCapsGbPerHour: SizeCaps;
};

export type PublicSettings = Settings;

export type User = {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
};

export type Session = {
  id: string;
  userId: number;
  expiresAt: string;
};

export const DEFAULT_SIZE_CAPS: SizeCaps = {
  movie1080p: 2.5,
  movie4kSdr: 6,
  movie4kHdr: 8,
  tv1080p: 1.0,
  tv4k: 4.0,
};

export function defaultSettings(): Settings {
  return {
    preferredLanguage: "eng",
    languageConfirmed: false,
    localAuthBypass: false,
    targetCodec: "hevc",
    concurrency: 1,
    multiSegment: false,
    offPeakEnabled: false,
    offPeakStart: "01:00",
    offPeakEnd: "07:00",
    workOnNas: true,
    localCopy: false,
    autoOptimize: false,
    reviewPath: "",
    sizeCapsGbPerHour: { ...DEFAULT_SIZE_CAPS },
  };
}
