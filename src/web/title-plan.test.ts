import { describe, expect, it } from "vitest";
import {
  audioActionSelectClass,
  audioChannelSelectClass,
  canIdentifyLanguage,
  canIdentifySubtitle,
  canQueueCustomPlan,
  formatClipClock,
  isImageSubtitle,
  parseClipClock,
  titleOptimizeLocked,
} from "./title-plan";

describe("title plan gating", () => {
  it("locks unreadable and uninspected titles and waits for a previewed plan", () => {
    expect(titleOptimizeLocked({ mediaState: "unreadable", error: "Path is unreadable." })).toBe(true);
    expect(titleOptimizeLocked({ mediaState: "waiting", inspected: false })).toBe(true);
    expect(titleOptimizeLocked({ mediaState: "inspected", inspected: true, error: null })).toBe(false);
    expect(titleOptimizeLocked({
      mediaState: "unreadable",
      inspected: true,
      error: "ffprobe failed.",
      path: "/mnt/nas/Cars 3.iso",
    })).toBe(false);
    expect(canQueueCustomPlan(null, [], false)).toBe(false);
    expect(canQueueCustomPlan({ video: { kind: "size" } }, [], false)).toBe(true);
    expect(canQueueCustomPlan({ video: { kind: "copy" } }, ["Do nothing"], false)).toBe(false);
  });

  it("gives the audio action select a width that fits Replace with downmix", () => {
    expect(audioActionSelectClass).toContain("w-56");
    expect(audioActionSelectClass).toContain("h-10");
    expect(audioChannelSelectClass).toContain("w-24");
  });

  it("offers language identification only for untagged audio when the listener is installed", () => {
    expect(canIdentifyLanguage({ language: "und", untagged: true, channels: 6 }, true, false)).toBe(true);
    expect(canIdentifyLanguage({ language: "eng", untagged: false, channels: 6 }, true, false)).toBe(false);
    expect(canIdentifyLanguage({ language: "und", untagged: true, channels: 6 }, false, false)).toBe(false);
    expect(formatClipClock(90)).toBe("1:30");
    expect(parseClipClock("10:00")).toBe(600);
    expect(parseClipClock("90")).toBe(90);
    expect(canIdentifySubtitle({ language: "und", untagged: true, codec: "subrip" }, false)).toBe(true);
    expect(canIdentifySubtitle({ language: "und", untagged: true, codec: "hdmv_pgs_subtitle" }, false)).toBe(false);
    expect(canIdentifySubtitle({ language: "eng", untagged: false, codec: "subrip" }, false)).toBe(false);
    expect(isImageSubtitle("hdmv_pgs_subtitle")).toBe(true);
  });
});
