import type { LibraryRow } from "./api.ts";

export function libraryRowView(item: LibraryRow): {
  video: string;
  audio: string;
  subtitles: string;
  planLines: string[];
} {
  if (item.error || item.mediaState === "unreadable") {
    return { video: "—", audio: "—", subtitles: "—", planLines: [item.error ?? "This file is unreadable."] };
  }
  if (!item.inspected || item.mediaState === "waiting") {
    return { video: "—", audio: "—", subtitles: "—", planLines: ["Waiting for inspect"] };
  }
  return {
    video: item.videoLabel || "Unknown codec",
    audio: item.audioLabels?.join(", ") || "None",
    subtitles: item.subtitleLabels?.join(", ") || "None",
    planLines: item.reasons.length > 0 ? item.reasons : ["Healthy"],
  };
}
