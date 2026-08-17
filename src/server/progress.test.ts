import { describe, expect, it } from "vitest";
import {
  clampProgress,
  etaSec,
  jobPhaseLabel,
  parseCopiedBytes,
  parseFfmpegOutTime,
  phaseForPlan,
  ratioProgress,
} from "./progress.ts";

describe("job phase labels", () => {
  it("names waiting, copy, remux, and transcode in operator language", () => {
    expect(jobPhaseLabel("queued")).toBe("Waiting in the queue");
    expect(jobPhaseLabel("held")).toBe("Waiting for the off-peak window");
    expect(jobPhaseLabel("copying")).toBe("Copying on the NAS");
    expect(jobPhaseLabel("copying", { copyMode: "proxy" })).toBe("Copying to the review path");
    expect(jobPhaseLabel("remuxing")).toBe("Remuxing tracks");
    expect(jobPhaseLabel("transcoding")).toBe("Transcoding to HEVC");
    expect(jobPhaseLabel("transcoding", { targetCodec: "av1" })).toBe("Transcoding to AV1");
    expect(jobPhaseLabel("finishing")).toBe("Checking the sidecar");
  });

  it("picks the work phase from the plan", () => {
    expect(phaseForPlan(["remux", "transcode"])).toBe("remuxing");
    expect(phaseForPlan(["transcode", "remux"])).toBe("remuxing");
    expect(phaseForPlan(["transcode"])).toBe("transcoding");
    expect(phaseForPlan(["remux"])).toBe("remuxing");
    expect(phaseForPlan(["add_stereo"])).toBe("remuxing");
    expect(phaseForPlan([])).toBe("copying");
  });
});

describe("progress parsers", () => {
  it("reads ffmpeg out_time and caps a running bar below 100%", () => {
    expect(parseFfmpegOutTime("out_time_ms=5000000\n")).toBe(5);
    expect(parseFfmpegOutTime("out_time_us=2500000\n")).toBe(2.5);
    expect(ratioProgress(5, 10)).toBe(0.5);
    expect(ratioProgress(10, 10)).toBe(0.99);
    expect(clampProgress(1, { allowComplete: true })).toBe(1);
  });

  it("reads dd byte counts and computes an ETA", () => {
    expect(parseCopiedBytes("1234567890 bytes (1.2 GB) copied, 12 s, 100 MB/s")).toBe(1234567890);
    expect(etaSec(50, 100, 10)).toBe(10);
    expect(etaSec(0, 100, 10)).toBeNull();
  });
});
