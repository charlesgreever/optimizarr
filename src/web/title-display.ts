export function fileNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "").trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

export function usefulTrackTitle(title: string | undefined, fileName: string): string | null {
  const value = title?.trim() ?? "";
  if (!value) return null;
  const base = fileName.replace(/\.[^.]+$/, "");
  if (value === fileName || (base && (value === base || value.includes(base)))) return null;
  if (/(?:^|\.)(?:19|20)\d{2}\./.test(value) && /2160p|1080p|720p|BluRay|WEB-?DL|WEBRip|x265|x264|HEVC/i.test(value)) {
    return null;
  }
  return value;
}

export function channelLabel(channels: number): string {
  if (channels === 2) return "stereo";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels}ch`;
}

export function hdrLabel(hdr: string | undefined): string | null {
  if (!hdr || hdr === "none") return "SDR";
  if (hdr === "hdr10") return "HDR10";
  if (hdr === "hdr10plus") return "HDR10+";
  if (hdr === "dolby_vision") return "Dolby Vision";
  return hdr;
}

export function formatDuration(durationSec: number | undefined): string | null {
  if (!durationSec || durationSec < 1) return null;
  const hours = Math.floor(durationSec / 3600);
  const minutes = Math.floor((durationSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
