export function sizeCapLabel(key: string): string {
  if (key === "movie1080p") return "Movie 1080p";
  if (key === "movie4kSdr") return "Movie 4K SDR";
  if (key === "movie4kHdr") return "Movie 4K HDR";
  if (key === "tv1080p") return "TV 1080p";
  if (key === "tv4k") return "TV 4K";
  return key;
}

export function transcodeBelowTargetLabel(target: "hevc" | "av1"): string {
  return `Transcode video below Target Encode (${target === "av1" ? "AV1" : "HEVC"})`;
}

export const FIELD_CONTROL = "h-10 w-full";
