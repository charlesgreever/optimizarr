export type SetupStatus = {
  needsFirstRun: boolean;
  languageConfirmed: boolean;
  setupComplete: boolean;
  onboardingComplete: boolean;
  authenticated: boolean;
  username: string | null;
  reviewPath?: string;
  suggestedReviewPath?: string | null;
  hasRadarr?: boolean;
  hasSonarr?: boolean;
  hasPlex?: boolean;
  hasJellyfin?: boolean;
};

export type Settings = {
  preferredLanguage: string;
  languageConfirmed: boolean;
  localAuthBypass: boolean;
  targetCodec: "hevc" | "av1";
  concurrency: number;
  multiSegment: boolean;
  offPeakEnabled: boolean;
  offPeakStart: string;
  offPeakEnd: string;
  workOnNas: boolean;
  localCopy: boolean;
  autoOptimize: boolean;
  reviewPath: string;
  sizeCapsGbPerHour: {
    movie1080p: number;
    movie4kSdr: number;
    movie4kHdr: number;
    tv1080p: number;
    tv4k: number;
  };
};

export type EmptyList = { items: unknown[]; message?: string; lastSyncAt?: string | null };

export type Player = {
  id: number;
  kind: "plex" | "jellyfin" | "other";
  name: string;
  url: string;
  enabled: boolean;
  hasToken: boolean;
};

export type ArrInstance = {
  id: number;
  kind: "radarr" | "sonarr";
  name: string;
  url: string;
  enabled: boolean;
  hasApiKey: boolean;
};

export type LibraryItem = {
  id: number;
  instanceId: number;
  instanceName: string;
  instanceKind: "radarr" | "sonarr";
  title: string;
  seriesTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  path: string;
  quality: string | null;
  videoCodec: string | null;
  resolution: string | null;
  hdr: string | null;
  size: number | null;
  readable: boolean;
  pathError: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  status: () => request<SetupStatus>("/api/setup/status"),
  firstRun: (body: { username: string; password: string; preferredLanguage: string }) =>
    request("/api/setup/first-run", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { username: string; password: string }) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (body: Partial<Settings>) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  updateCredentials: (body: { currentPassword: string; username: string; password?: string }) =>
    request("/api/auth/credentials", { method: "PUT", body: JSON.stringify(body) }),
  instances: () => request<{ items: ArrInstance[] }>("/api/instances"),
  createInstance: (body: {
    kind: "radarr" | "sonarr";
    name: string;
    url: string;
    apiKey: string;
    enabled?: boolean;
  }) => request<ArrInstance>("/api/instances", { method: "POST", body: JSON.stringify(body) }),
  updateInstance: (id: number, body: Partial<{ name: string; url: string; apiKey: string; enabled: boolean }>) =>
    request<ArrInstance>(`/api/instances/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteInstance: (id: number) => request(`/api/instances/${id}`, { method: "DELETE" }),
  testInstance: (id: number) =>
    request<{ ok: boolean; version?: string; error?: string }>(`/api/instances/${id}/test`, { method: "POST" }),
  refreshLibrary: (opts?: { inspect?: "none" | "pending" }) =>
    request<{ movies: number; errors: string[]; lastSyncAt: string | null; suggestedReviewPath?: string | null }>(
      "/api/library/refresh",
      { method: "POST", body: JSON.stringify(opts ?? {}) },
    ),
  movies: () => request<EmptyList & { items: LibraryItem[] }>("/api/library/movies"),
  series: () => request<EmptyList>("/api/library/series"),
  suggestions: (params?: URLSearchParams) =>
    request<EmptyList>(`/api/suggestions${params && [...params].length ? `?${params}` : ""}`),
  dismissSuggestion: (id: number) => request(`/api/suggestions/${id}/dismiss`, { method: "POST" }),
  forceItem: (id: number) => request(`/api/library/items/${id}/force`, { method: "POST" }),
  addStereo: (id: number) => request(`/api/library/items/${id}/stereo`, { method: "POST" }),
  hardware: () => request<{ cuda: boolean; vaapi: boolean; av1: boolean }>("/api/hardware"),
  queue: () => request<EmptyList>("/api/queue"),
  enqueue: (suggestionId: number) =>
    request("/api/queue", { method: "POST", body: JSON.stringify({ suggestionId }) }),
  review: () => request<EmptyList>("/api/review"),
  keepReview: (id: number) => request(`/api/review/${id}/keep`, { method: "POST" }),
  discardReview: (id: number) => request(`/api/review/${id}/discard`, { method: "POST" }),
  players: () => request<{ items: Player[] }>("/api/players"),
  createPlayer: (body: { kind: "plex" | "jellyfin" | "other"; name: string; url: string; token: string }) =>
    request<Player>("/api/players", { method: "POST", body: JSON.stringify(body) }),
  updatePlayer: (id: number, body: Partial<{ name: string; url: string; token: string; enabled: boolean }>) =>
    request<Player>(`/api/players/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deletePlayer: (id: number) => request(`/api/players/${id}`, { method: "DELETE" }),
  testPlayer: (id: number) =>
    request<{ ok: boolean; version?: string; error?: string }>(`/api/players/${id}/test`, { method: "POST" }),
  history: () => request<EmptyList>("/api/history"),
};

export const LANGUAGES = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "ita", label: "Italian" },
  { code: "por", label: "Portuguese" },
  { code: "nld", label: "Dutch" },
  { code: "swe", label: "Swedish" },
  { code: "nor", label: "Norwegian" },
  { code: "dan", label: "Danish" },
  { code: "pol", label: "Polish" },
  { code: "rus", label: "Russian" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
  { code: "zho", label: "Chinese" },
  { code: "hin", label: "Hindi" },
  { code: "ara", label: "Arabic" },
];
