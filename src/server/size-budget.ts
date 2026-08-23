import type { InspectionReport } from "./types.ts";

/** Fraction of the GB/hr cap a file may exceed before Polisharr treats it as over. */
export const SIZE_CAP_TOLERANCE = 0.05;
const ENCODER_SLACK = 0.08;
const MUX_OVERHEAD_BYTES = 8_000_000;
const MIN_VIDEO_BPS = 800_000;
const MAX_VIDEO_BPS = 300_000_000;

export function exceedsSizeCap(sizePerHourGb: number, cap: number): boolean {
  return sizePerHourGb > cap * (1 + SIZE_CAP_TOLERANCE);
}

export function typicalAudioBitrateBps(track: { codec: string; channels: number; title?: string }): number {
  const codec = `${track.codec} ${track.title ?? ""}`.toLowerCase();
  const channels = Math.max(1, track.channels || 2);
  if (/truehd|mlp/.test(codec)) return channels > 6 ? 5_000_000 : 3_000_000;
  if (/dts/.test(codec) && /ma|hd|atmos/.test(codec)) return 3_840_000;
  if (/\bdts\b/.test(codec)) return 1_536_000;
  if (/flac/.test(codec)) return Math.round(1_000_000 * (channels / 2));
  if (/pcm|lpcm/.test(codec)) return 768_000 * channels;
  if (/eac3|ec-3/.test(codec)) return channels > 2 ? 768_000 : 192_000;
  if (/ac3/.test(codec)) return channels > 2 ? 640_000 : 192_000;
  if (/aac/.test(codec)) return channels > 2 ? 384_000 : 192_000;
  if (/opus/.test(codec)) return 160_000;
  return 256_000;
}

export function copiedAudioBitrateBps(report: InspectionReport): number {
  return report.audio.reduce((sum, track) => sum + typicalAudioBitrateBps(track), 0);
}

export function videoBitrateForTarget(input: {
  targetBytes: number;
  durationSec: number;
  audioBitrateBps: number;
}): number {
  const audioBytes = (input.audioBitrateBps / 8) * input.durationSec;
  const usable = Math.max(0, input.targetBytes * (1 - ENCODER_SLACK) - audioBytes - MUX_OVERHEAD_BYTES);
  const bitrate = Math.round((usable * 8) / input.durationSec);
  if (bitrate > MAX_VIDEO_BPS) {
    const gb = (input.targetBytes / 1024 ** 3).toFixed(1);
    const minutes = Math.max(1, Math.round(input.durationSec / 60));
    throw new Error(
      `A ${gb} GB target over ${minutes} minutes needs ${(bitrate / 1_000_000).toFixed(0)} Mbps, which the hardware encoder will reject. The remux is probably a short title, not the feature.`,
    );
  }
  if (bitrate < MIN_VIDEO_BPS) {
    const audioGb = audioBytes / 1024 ** 3;
    const targetGb = input.targetBytes / 1024 ** 3;
    throw new Error(
      `Kept audio is about ${audioGb.toFixed(1)} GB; a ${targetGb.toFixed(1)} GB target leaves too little room for video. Exempt this title or drop extra lossless tracks.`,
    );
  }
  return bitrate;
}
