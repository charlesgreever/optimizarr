import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseArrWebhook, presentedWebhookToken, webhookTokenMatches } from "./arr-webhook.ts";

describe("Arr webhook payload", () => {
  it("treats Download and Rename as library syncs and Test as a no-op", () => {
    expect(parseArrWebhook({ eventType: "Download", movie: { id: 12 } })).toEqual({
      eventType: "Download",
      syncsLibrary: true,
      movieId: 12,
      seriesId: null,
    });
    expect(parseArrWebhook({ eventType: "Rename", series: { id: 4 } }).syncsLibrary).toBe(true);
    expect(parseArrWebhook({ eventType: "Test" }).syncsLibrary).toBe(false);
    expect(parseArrWebhook({ eventType: "Grab", movie: { id: 1 } }).syncsLibrary).toBe(false);
    expect(parseArrWebhook(null).syncsLibrary).toBe(false);
  });
});

describe("webhook token presentation", () => {
  it("reads X-Api-Key, Bearer, Basic password, then query apikey", () => {
    expect(presentedWebhookToken({ apiKey: " header " })).toBe("header");
    expect(presentedWebhookToken({ authorization: "Bearer abc" })).toBe("abc");
    expect(presentedWebhookToken({ authorization: `Basic ${Buffer.from("hook:secret").toString("base64")}` })).toBe("secret");
    expect(presentedWebhookToken({ queryKey: "qs" })).toBe("qs");
    expect(presentedWebhookToken({})).toBeNull();
  });

  it("matches a sha256 hash and rejects a wrong token", () => {
    const hash = createHash("sha256").update("good").digest("hex");
    expect(webhookTokenMatches("good", hash)).toBe(true);
    expect(webhookTokenMatches("bad", hash)).toBe(false);
    expect(webhookTokenMatches("good", null)).toBe(false);
    expect(webhookTokenMatches(null, hash)).toBe(false);
  });
});
