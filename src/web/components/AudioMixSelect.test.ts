import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudioMixSelect } from "./AudioMixSelect";

describe("audio mix select", () => {
  it("offers house default, prefer stereo, and keep surround", () => {
    const html = renderToStaticMarkup(createElement(AudioMixSelect, {
      value: "stereo",
      onChange: () => undefined,
    }));
    expect(html).toContain("Preferred audio");
    expect(html).toContain("House default");
    expect(html).toContain("Prefer stereo");
    expect(html).toContain("Keep surround");
  });
});
