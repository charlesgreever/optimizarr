import { describe, expect, it } from "vitest";
import { libraryRowView } from "./library-row.ts";
import type { LibraryRow } from "./api.ts";

function row(patch: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: "movie-1",
    instanceId: "radarr",
    displayTitle: "Film",
    instanceName: "Radarr",
    type: "movie",
    showTitle: null,
    quality: "Bluray-1080p",
    path: "/movies/film.mkv",
    sizeBytes: 1_000,
    sizeExempt: false,
    inspected: true,
    mediaState: "inspected",
    hasPoster: false,
    error: null,
    reasons: [],
    suggestion: null,
    videoLabel: "hevc · 1920x1080",
    audioLabels: ["eng truehd 7.1"],
    subtitleLabels: [],
    ...patch,
  };
}

describe("dense library row presentation", () => {
  it("distinguishes no subtitles, waiting, unreadable, and every plan reason", () => {
    expect(libraryRowView(row())).toMatchObject({
      subtitles: "None",
      subtitleTracks: [],
      audioTracks: ["eng truehd 7.1"],
      planLines: ["Healthy"],
    });
    expect(libraryRowView(row({ reasons: ["Video is over the size cap.", "Spanish tracks will be removed."] })).planLines).toEqual([
      "Video is over the size cap.",
      "Spanish tracks will be removed.",
    ]);
    expect(libraryRowView(row({ inspected: false, mediaState: "waiting", videoLabel: null, audioLabels: [], subtitleLabels: [] }))).toMatchObject({
      video: "—",
      audio: "—",
      subtitles: "—",
      planLines: ["Waiting for inspect"],
    });
    expect(libraryRowView(row({ inspected: false, mediaState: "unreadable", error: "Path is unreadable.", videoLabel: null }))).toMatchObject({
      video: "—",
      audio: "—",
      subtitles: "—",
      planLines: ["Path is unreadable."],
    });
  });
});
