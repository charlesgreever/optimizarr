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
        transcodeBelowHevc: false,
        convertMp4ToMkv: false,
        convertIsoToMkv: false,
        searchPreferredLanguage: false,
        queueNewImports: false,
      },
      onChange: () => undefined,
      onSave: () => undefined,
    }));

    expect(html).toContain("Default suggestion operations");
    expect(html).toContain("Transcode video below Target Encode (HEVC)");
    expect(html).toContain("Convert MP4 to MKV");
    expect(html).toContain("Convert ISO to MKV");
    expect(html).toContain("Queue new Arr imports automatically");
    expect(html).toContain("Keep still replaces the library file and does not queue that file again");
    expect(html).toContain("A later Arr upgrade still can");
    expect(html).toContain("Turning that on does not queue your existing library");
    expect(html).toContain("Save suggestion defaults");
  });

  it("names the below-target checkbox after Encode Target AV1", () => {
    const html = renderToStaticMarkup(createElement(SuggestionDefaultsSettings, {
      value: {
        removeNonPreferredSubtitles: true,
        removeNonPreferredAudio: true,
        addStereo: true,
        transcodeToSizeCap: true,
        transcodeBelowHevc: false,
        convertMp4ToMkv: false,
        convertIsoToMkv: false,
        searchPreferredLanguage: false,
        queueNewImports: false,
      },
      videoTarget: "av1",
      onChange: () => undefined,
      onSave: () => undefined,
    }));

    expect(html).toContain("Transcode video below Target Encode (AV1)");
    expect(html).not.toContain("Transcode video below Target Encode (HEVC)");
  });
});
