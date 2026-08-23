import { describe, expect, it } from "vitest";
import { copiedAudioBitrateBps, exceedsSizeCap, typicalAudioBitrateBps, videoBitrateForTarget } from "./size-budget.ts";
import type { InspectionReport } from "./types.ts";

describe("size budget", () => {
  it("treats a file a little over the cap as still within the cap", () => {
    expect(exceedsSizeCap(8.2, 8)).toBe(false);
    expect(exceedsSizeCap(8.5, 8)).toBe(true);
    expect(exceedsSizeCap(10.69, 8)).toBe(true);
  });

  it("reserves more video bitrate for a TrueHD Atmos movie than a flat 80 MB pad", () => {
    const durationSec = 7139.5;
    const targetBytes = 8 * (durationSec / 3600) * 1024 ** 3;
    const report = {
      audio: [
        { codec: "truehd", channels: 8, title: "Atmos" },
        { codec: "aac", channels: 2, title: "" },
        { codec: "ac3", channels: 6, title: "" },
        { codec: "truehd", channels: 8, title: "TrueHD" },
      ],
    } as InspectionReport;
    const withAudio = videoBitrateForTarget({
      targetBytes,
      durationSec,
      audioBitrateBps: copiedAudioBitrateBps(report),
    });
    const withoutAudio = videoBitrateForTarget({ targetBytes, durationSec, audioBitrateBps: 0 });
    expect(typicalAudioBitrateBps({ codec: "truehd", channels: 8 })).toBe(5_000_000);
    expect(withAudio).toBeLessThan(withoutAudio * 0.6);
    expect(withAudio).toBeGreaterThan(800_000);
  });

  it("refuses a size target that the kept audio already fills", () => {
    expect(() => videoBitrateForTarget({
      targetBytes: 2 * 1024 ** 3,
      durationSec: 7200,
      audioBitrateBps: 5_000_000,
    })).toThrow(/Kept audio is about 4\.2 GB/);
  });
});
