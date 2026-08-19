import { describe, expect, it } from "vitest";
import { estimateOutputBytes, validateCustomPlan } from "./custom-plan.ts";
import { DEFAULT_SETTINGS, planHasVideoTranscode } from "./types.ts";
import type { HardwareInfo, InspectionReport, LibraryItem } from "./types.ts";

const movie: LibraryItem = {
  id: "m1",
  instanceId: "radarr",
  instanceName: "Radarr",
  arrId: 1,
  arrSeriesId: null,
  arrEpisodeFileId: null,
  type: "movie",
  title: "Example",
  showTitle: null,
  season: null,
  episode: null,
  episodeTitle: null,
  path: "/mnt/nas/Example.mkv",
  sizeBytes: 16_000_000_000,
  quality: "Bluray-1080p",
  resolution: "1080",
  profile: "HD",
  tags: [],
  posterRemoteUrl: null,
  hasPoster: false,
  sizeExempt: false,
};

const hw: HardwareInfo = { backend: "cuda", cuda: true, vaapi: false, av1: false, reason: null };

function report(over: Partial<InspectionReport> = {}): InspectionReport {
  return {
    sourceSig: "p|1",
    sourceMethod: "ffprobe",
    listingState: "complete",
    durationSec: 5900,
    sizeBytes: 16_000_000_000,
    sizePerHourGb: 9.8,
    videoCodec: "hevc",
    width: 1920,
    height: 1080,
    bitDepth: 10,
    hdr: "none",
    audio: [
      { index: 1, language: "eng", channels: 8, codec: "truehd", title: "Atmos", untagged: false, commentary: false },
      { index: 2, language: "spa", channels: 2, codec: "aac", title: "", untagged: false, commentary: false },
    ],
    subtitles: [{ index: 3, language: "spa", codec: "srt", title: "", untagged: false, forced: false, sdh: false }],
    hasChapters: true,
    hasAttachments: false,
    ...over,
  };
}

function check(draft: Parameters<typeof validateCustomPlan>[0]["draft"], over: { item?: LibraryItem; report?: InspectionReport; hardware?: HardwareInfo; settings?: typeof DEFAULT_SETTINGS } = {}) {
  return validateCustomPlan({
    item: over.item ?? movie,
    report: over.report ?? report(),
    settings: over.settings ?? DEFAULT_SETTINGS,
    hardware: over.hardware ?? hw,
    draft,
  });
}

describe("custom plan validation", () => {
  it("rejects a do-nothing MKV plan", () => {
    const result = check({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe("plan");
  });

  it("allows removing one audio and subtitle track", () => {
    const result = check({ audio: [{ index: 2, action: "remove" }], subtitles: [{ index: 3, action: "remove" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.audio.find((a) => a.index === 2)?.op).toBe("remove");
    expect(result.plan.subtitles.find((s) => s.index === 3)?.op).toBe("remove");
    expect(result.plan.reasons.some((r) => r.includes("Remove audio"))).toBe(true);
  });

  it("rejects removing every audio track", () => {
    const result = check({ audio: [{ index: 1, action: "remove" }, { index: 2, action: "remove" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "audio")).toBe(true);
  });

  it("treats ISO remux with video copy as real work and forces Matroska", () => {
    const result = check({ remuxToMkv: true }, { item: { ...movie, path: "/mnt/nas/disc.iso" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.container).toBe("mkv");
    expect(result.plan.video.kind).toBe("copy");
    expect(planHasVideoTranscode(result.plan)).toBe(false);
    expect(result.plan.reasons.some((r) => /Remux/.test(r))).toBe(true);
  });

  it("rejects track edits when ISO streams could not be listed, but still allows remux", () => {
    const unlisted = report({ sourceMethod: "iso_ffmpeg", listingState: "iso_unlisted", audio: [], subtitles: [] });
    const blocked = check(
      { remuxToMkv: true, audio: [{ index: 1, action: "remove" }] },
      { item: { ...movie, path: "/mnt/nas/disc.iso" }, report: unlisted },
    );
    expect(blocked.ok).toBe(false);
    const remux = check({ remuxToMkv: true }, { item: { ...movie, path: "/mnt/nas/disc.iso" }, report: unlisted });
    expect(remux.ok).toBe(true);
  });

  it("replaces a soundtrack with same-layout AAC and does not keep the source", () => {
    const result = check({ audio: [{ index: 1, action: "replace_aac" }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.audio.find((a) => a.index === 1)?.op).toBe("replace_aac");
    expect(result.plan.audio.filter((a) => a.index === 1 && a.op === "keep")).toHaveLength(0);
  });

  it("allows a 7.1 downmix to 5.1 or stereo as replace or add", () => {
    const replace = check({ audio: [{ index: 1, action: "replace_downmix", channels: 6 }] });
    const add = check({ audio: [{ index: 1, action: "add_downmix", channels: 2 }] });
    expect(replace.ok).toBe(true);
    expect(add.ok).toBe(true);
    if (replace.ok) expect(replace.plan.audio.find((a) => a.op === "replace_downmix")?.channels).toBe(6);
    if (add.ok) {
      expect(add.plan.audio.some((a) => a.op === "keep" && a.index === 1)).toBe(true);
      expect(add.plan.audio.some((a) => a.op === "add_downmix" && a.channels === 2)).toBe(true);
    }
  });

  it("rejects a missing stream and a same-or-wider downmix", () => {
    expect(check({ audio: [{ index: 99, action: "remove" }] }).ok).toBe(false);
    expect(check({ audio: [{ index: 1, action: "replace_downmix", channels: 8 }] }).ok).toBe(false);
  });

  it("rejects size and quality fighting and defaults transcodes to HEVC", () => {
    const size = check({ video: { mode: "size", targetBytes: 4_000_000_000 } });
    const quality = check({ video: { mode: "quality", quality: 22 } });
    expect(size.ok).toBe(true);
    expect(quality.ok).toBe(true);
    if (size.ok) {
      expect(size.plan.video.kind).toBe("size");
      if (size.plan.video.kind === "size") expect(size.plan.video.codec).toBe("hevc");
      expect(size.plan.estimatedOutputBytes).toBe(4_000_000_000);
      expect(size.plan.reasons.some((r) => /targeting a/.test(r))).toBe(true);
    }
    if (quality.ok) {
      expect(quality.plan.video.kind).toBe("quality");
      expect(quality.plan.reasons.some((r) => /encoder quality/.test(r))).toBe(true);
      expect(planHasVideoTranscode(quality.plan)).toBe(true);
    }
  });

  it("gates AV1, rejects downscale on remux, and keeps bit depth plus HDR warning", () => {
    const av1 = check({ video: { mode: "quality", quality: 20, codec: "av1" } });
    expect(av1.ok).toBe(false);
    const downscaleCopy = check({ video: { mode: "copy", downscale1080p: true } as never });
    expect(downscaleCopy.ok).toBe(false);
    const hdr = check(
      { video: { mode: "size", targetBytes: 6_000_000_000, downscale1080p: true } },
      {
        item: { ...movie, quality: "WEBDL-2160p", resolution: "2160" },
        report: report({ width: 3840, height: 2160, hdr: "dolby_vision" }),
        hardware: { ...hw, av1: true },
      },
    );
    expect(hdr.ok).toBe(true);
    if (!hdr.ok) return;
    expect(hdr.plan.warning).toMatch(/Dolby Vision/);
    if (hdr.plan.video.kind !== "copy") expect(hdr.plan.video.bitDepth).toBe(10);
  });

  it("estimates quality mode monotonically and labels size mode as the typed target", () => {
    const src = report();
    const high = estimateOutputBytes(src, { kind: "quality", codec: "hevc", quality: 18, downscale1080p: false, bitDepth: 10 });
    const low = estimateOutputBytes(src, { kind: "quality", codec: "hevc", quality: 32, downscale1080p: false, bitDepth: 10 });
    const scaled = estimateOutputBytes(src, { kind: "quality", codec: "hevc", quality: 18, downscale1080p: true, bitDepth: 10 });
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(low!).toBeLessThan(high!);
    expect(scaled!).toBeLessThanOrEqual(high!);
    expect(estimateOutputBytes(src, { kind: "size", codec: "hevc", targetBytes: 3_000_000_000, downscale1080p: false, bitDepth: 10 })).toBe(3_000_000_000);
  });

  it("applies a per-job write-mode override in the reasons", () => {
    const result = check({ audio: [{ index: 2, action: "remove" }], writeMode: "direct" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.writeMode).toBe("direct");
    expect(result.plan.reasons.some((r) => /directly/.test(r))).toBe(true);
  });
});
