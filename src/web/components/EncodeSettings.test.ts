import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EncodeSettings } from "./EncodeSettings";

describe("encode settings", () => {
  it("places an explicit save action beside concurrent jobs", () => {
    const html = renderToStaticMarkup(createElement(EncodeSettings, {
      data: {
        videoTarget: "hevc",
        concurrency: 4,
        conservativeMode: false,
        offPeakEnabled: false,
        offPeakStart: "22:00",
        offPeakEnd: "06:00",
      },
      hardwareLabel: "CUDA",
      onChange: vi.fn(),
      onSave: vi.fn(),
    }));

    expect(html).toContain("Concurrent jobs");
    expect(html).toContain("Save encode settings");
  });
});
