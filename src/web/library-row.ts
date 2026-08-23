import type { LibraryRow } from "./api.ts";

export function libraryRowView(item: LibraryRow): {
  video: string;
  audio: string;
  subtitles: string;
  planLines: string[];
  audioTracks: string[];
  subtitleTracks: string[];
} {
  if (item.error || item.mediaState === "unreadable") {
    return {
      video: "—",
      audio: "—",
      subtitles: "—",
      planLines: [item.error ?? "This file is unreadable."],
      audioTracks: [],
      subtitleTracks: [],
    };
  }
  if (!item.inspected || item.mediaState === "waiting") {
    return {
      video: "—",
      audio: "—",
      subtitles: "—",
      planLines: ["Waiting for inspect"],
      audioTracks: [],
      subtitleTracks: [],
    };
  }
  const audioTracks = item.audioLabels ?? [];
  const subtitleTracks = item.subtitleLabels ?? [];
  return {
    video: item.videoLabel || "Unknown codec",
    audio: audioTracks.join(", ") || "None",
    subtitles: subtitleTracks.join(", ") || "None",
    planLines: item.reasons.length > 0 ? item.reasons : ["Healthy"],
    audioTracks,
    subtitleTracks,
  };
}
