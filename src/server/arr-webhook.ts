import { createHash, timingSafeEqual } from "node:crypto";

const SYNC_EVENTS = new Set(["download", "rename", "import", "upgrade"]);

export type ArrWebhookEvent = {
  eventType: string;
  syncsLibrary: boolean;
  movieId: number | null;
  seriesId: number | null;
};

export function parseArrWebhook(payload: unknown): ArrWebhookEvent {
  const rec = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const eventType = typeof rec.eventType === "string" ? rec.eventType : "";
  const movie = rec.movie && typeof rec.movie === "object" && !Array.isArray(rec.movie) ? (rec.movie as Record<string, unknown>) : null;
  const series = rec.series && typeof rec.series === "object" && !Array.isArray(rec.series) ? (rec.series as Record<string, unknown>) : null;
  return {
    eventType,
    syncsLibrary: SYNC_EVENTS.has(eventType.toLowerCase()),
    movieId: typeof movie?.id === "number" ? movie.id : null,
    seriesId: typeof series?.id === "number" ? series.id : null,
  };
}

export function presentedWebhookToken(headers: {
  apiKey?: string | undefined;
  authorization?: string | undefined;
  queryKey?: string | undefined;
}): string | null {
  const header = headers.apiKey?.trim();
  if (header) return header;
  const auth = headers.authorization?.trim() ?? "";
  const bearer = /^Bearer\s+(\S+)/i.exec(auth);
  if (bearer?.[1]) return bearer[1];
  const basic = /^Basic\s+(\S+)/i.exec(auth);
  if (basic?.[1]) {
    try {
      const decoded = Buffer.from(basic[1], "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon >= 0) return decoded.slice(colon + 1);
    } catch {
      return null;
    }
  }
  const query = headers.queryKey?.trim();
  return query || null;
}

export function webhookTokenMatches(presented: string | null, storedHexHash: string | null): boolean {
  if (!presented || !storedHexHash) return false;
  const got = createHash("sha256").update(presented).digest();
  try {
    const want = Buffer.from(storedHexHash, "hex");
    if (want.length !== got.length) return false;
    return timingSafeEqual(got, want);
  } catch {
    return false;
  }
}
