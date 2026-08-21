export type SuggestionFilters = {
  type?: "movie" | "episode";
  resolution?: "1080p" | "4k";
  hdr?: "hdr" | "sdr";
  codec?: "h264" | "hevc" | "av1";
  overCap?: boolean;
  extraTracks?: boolean;
  exempt?: boolean;
  hardwareWarning?: boolean;
};

export function parseSuggestionFilters(value: unknown): { ok: true; filters: SuggestionFilters } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, filters: {} };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Suggestion filters must be an object." };
  }
  const raw = value as Record<string, unknown>;
  const filters: SuggestionFilters = {};
  for (const [field, allowed] of [
    ["type", ["movie", "episode"]],
    ["resolution", ["1080p", "4k"]],
    ["hdr", ["hdr", "sdr"]],
    ["codec", ["h264", "hevc", "av1"]],
  ] as const) {
    if (raw[field] === undefined || raw[field] === "") continue;
    if (!(allowed as readonly unknown[]).includes(raw[field])) return { ok: false, error: `The ${field} suggestion filter is invalid.` };
    Object.assign(filters, { [field]: raw[field] });
  }
  for (const field of ["overCap", "extraTracks", "exempt", "hardwareWarning"] as const) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] !== "boolean") return { ok: false, error: `The ${field} suggestion filter is invalid.` };
    filters[field] = raw[field];
  }
  return { ok: true, filters };
}
