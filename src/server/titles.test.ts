import { describe, expect, it } from "vitest";
import { displayTitle, matchesTitleSearch, seasonLabel } from "./titles.ts";

describe("series display titles", () => {
  it("keeps a movie as its title", () => {
    expect(displayTitle({ title: "American Underdog" })).toBe("American Underdog");
  });

  it("shows show, season, then episode title", () => {
    expect(
      displayTitle({
        title: "(I Don’t Want to Go to) Chelsea",
        seriesTitle: "Ted Lasso",
        seasonNumber: 3,
        episodeNumber: 2,
      }),
    ).toBe("Ted Lasso / Season 3 / (I Don’t Want to Go to) Chelsea");
  });

  it("labels season 0 as Specials", () => {
    expect(seasonLabel(0)).toBe("Specials");
    expect(displayTitle({ title: "Christmas", seriesTitle: "Ted Lasso", seasonNumber: 0 })).toBe(
      "Ted Lasso / Specials / Christmas",
    );
  });

  it("finds an episode by show name", () => {
    const item = { title: "Chelsea", seriesTitle: "Ted Lasso", seasonNumber: 3 };
    expect(matchesTitleSearch(item, "ted lasso")).toBe(true);
    expect(matchesTitleSearch(item, "chelsea")).toBe(true);
    expect(matchesTitleSearch(item, "underdog")).toBe(false);
  });
});
