import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FilterChip, MediaSnapshot, PillList, PlanStatus } from "./ui";

describe("media display", () => {
  it("renders each audio track as its own label instead of a comma-joined blob", () => {
    const html = renderToStaticMarkup(createElement(PillList, {
      items: ["eng eac3 5.1", "eng aac 2.0"],
      empty: "None",
    }));
    expect(html).toContain("eng eac3 5.1");
    expect(html).toContain("eng aac 2.0");
    expect(html).not.toContain("eng eac3 5.1, eng aac 2.0");
  });

  it("marks a healthy plan distinctly from work reasons", () => {
    expect(renderToStaticMarkup(createElement(PlanStatus, { lines: ["Healthy"] }))).toContain("Healthy");
    const work = renderToStaticMarkup(createElement(PlanStatus, { lines: ["Over the size cap."] }));
    expect(work).toContain("Over the size cap.");
    expect(work).toContain("<li");
  });

  it("shows after-size savings in the snapshot", () => {
    const html = renderToStaticMarkup(createElement(MediaSnapshot, {
      snapshot: {
        codec: "HEVC",
        quality: null,
        sizeBytes: 15_870_000_000,
        sizePerHourGb: 8,
        tracks: ["Audio: eng truehd 7.1"],
      },
      savingsBytes: 5_770_000_000,
      emphasize: true,
    }));
    expect(html).toContain("HEVC");
    expect(html).toContain("save");
    expect(html).toContain("Audio: eng truehd 7.1");
  });

  it("exposes filter chips as toggle buttons", () => {
    const html = renderToStaticMarkup(createElement(FilterChip, {
      pressed: true,
      onToggle: vi.fn(),
      children: "Over cap",
    }));
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("Over cap");
  });
});
