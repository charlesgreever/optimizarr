import type { AudioTrack, InspectionReport, SubtitleTrack, Suggestion } from "./types.ts";

export function audioTrackLabel(track: AudioTrack): string {
  return `Audio: ${track.language} ${track.codec} ${audioLayout(track.channels)}`;
}

export function subtitleTrackLabel(track: SubtitleTrack): string {
  const labels = ["Subtitle:", track.language, track.codec];
  if (track.forced) labels.push("Forced");
  if (track.sdh) labels.push("SDH");
  return labels.join(" ");
}

export function suggestionTrackComparison(report: InspectionReport | null, suggestion: Suggestion): {
  nowTracks: string[];
  afterTracks: string[];
} {
  if (!report) return { nowTracks: [], afterTracks: [] };
  const keptAudio = new Set(suggestion.keepAudio);
  const keptSubs = new Set(suggestion.keepSubs);
  const afterTracks = [
    ...report.audio.filter((track) => keptAudio.has(track.index)).map(audioTrackLabel),
    ...report.subtitles.filter((track) => keptSubs.has(track.index)).map(subtitleTrackLabel),
  ];
  if (suggestion.actions.includes("add_stereo")) afterTracks.push("Audio: AAC 2.0 (added)");
  return {
    nowTracks: [...report.audio.map(audioTrackLabel), ...report.subtitles.map(subtitleTrackLabel)],
    afterTracks,
  };
}

function audioLayout(channels: number): string {
  if (channels === 1) return "Mono";
  if (channels === 2) return "2.0";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return channels > 0 ? `${channels} ch` : "Unknown layout";
}
