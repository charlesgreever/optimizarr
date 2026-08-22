import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SuggestionDefaultsSettings } from "./SuggestionDefaultsSettings";

describe("suggestion defaults settings", () => {
  it("shows the opt-in MP4 conversion beside the automatic operations", () => {
    const html = renderToStaticMarkup(createElement(SuggestionDefaultsSettings, {
      value: {
        removeNonPreferredSubtitles: true,
        removeNonPreferredAudio: true,
        addStereo: true,
        transcodeToSizeCap: true,
        convertMp4ToMkv: false,
      },
      onChange: () => undefined,
      onSave: () => undefined,
    }));

    expect(html).toContain("Default suggestion operations");
    expect(html).toContain("Convert MP4 to MKV");
    expect(html).toContain("Save suggestion defaults");
  });
});
