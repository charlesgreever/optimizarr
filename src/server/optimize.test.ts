import { describe, expect, it } from "vitest";
import { formatToolError, muxArgs } from "./optimize.ts";
import type { Suggestion } from "./types.ts";

const suggestion: Suggestion = {
  id: "s1",
  itemId: "m1",
  actions: ["tracks", "add_stereo"],
  reasons: [],
  warning: null,
  category: "movie4kHdr",
  estimatedSavingsBytes: null,
  now: { codec: "hevc", quality: "Bluray-2160p", sizeBytes: 1, sizePerHourGb: 8 },
  after: { codec: "hevc", quality: null, sizeBytes: null, sizePerHourGb: null },
  dismissed: false,
  keepAudio: [1, 2],
  stripAudio: [],
  keepSubs: [3, 4],
  stripSubs: [],
};

const source =
  "/mnt/nas/Kids Movies/Big Hero 6 (2014)/Big Hero 6 (2014) {imdb-tt2245084}[Bluray-2160p][HDR][10bit][HEVC][TrueHD Atmos 7.1].mkv";

describe("mkvmerge arguments", () => {
  it("keeps a parenthesized source path as one operand and applies track options to that file", () => {
    const args = muxArgs(source, "/mnt/nas/review-path/.work/out.mkv", suggestion, "/tmp/stereo.aac");
    expect(args).toContain(source);
    expect(args.filter((part) => part.includes("Big Hero 6")).length).toBe(1);
    const sourceAt = args.indexOf(source);
    const audioAt = args.indexOf("--audio-tracks");
    const subsAt = args.indexOf("--subtitle-tracks");
    const stereoAt = args.indexOf("/tmp/stereo.aac");
    expect(audioAt).toBeGreaterThan(-1);
    expect(audioAt).toBeLessThan(sourceAt);
    expect(subsAt).toBeLessThan(sourceAt);
    expect(stereoAt).toBeGreaterThan(sourceAt);
    expect(args.join(" ")).not.toContain("mkvmerge -o");
  });

  it("does not expose an unquoted command line when a tool fails", () => {
    const message = formatToolError("mkvmerge", {
      message: `Command failed: mkvmerge -o out.mkv ${source}`,
      stderr: "Error: The file could not be opened.",
    });
    expect(message).toContain("mkvmerge failed");
    expect(message).toContain("The file could not be opened.");
    expect(message).not.toContain("Command failed:");
  });
});
