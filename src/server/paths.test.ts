import { describe, expect, it } from "vitest";
import { commonDirectory, suggestReviewPath } from "./paths.ts";

describe("review path suggestion", () => {
  it("uses the shared Arr root plus optimizarr-review", () => {
    expect(
      suggestReviewPath([
        "/mnt/nas/Movies/Up (2009)/Up.mkv",
        "/mnt/nas/TV/Andor/Season 1/Andor S01E01.mkv",
      ]),
    ).toBe("/mnt/nas/optimizarr-review");
  });

  it("walks up from a single movie folder to the NAS share", () => {
    expect(suggestReviewPath(["/mnt/nas/Movies/Up (2009)/Up.mkv"])).toBe("/mnt/nas/optimizarr-review");
  });

  it("returns null when there is no shared root", () => {
    expect(suggestReviewPath([])).toBeNull();
    expect(commonDirectory(["/movies/a", "/tv/b"])).toBeNull();
  });
});
