export type SetupStatus = {
  needsFirstRun: boolean;
  languageConfirmed: boolean;
  setupComplete: boolean;
  authenticated: boolean;
  username: string | null;
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

export type EmptyList = { items: unknown[]; message?: string };

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
  movies: () => request<EmptyList>("/api/library/movies"),
  series: () => request<EmptyList>("/api/library/series"),
  suggestions: () => request<EmptyList>("/api/suggestions"),
  queue: () => request<EmptyList>("/api/queue"),
  review: () => request<EmptyList>("/api/review"),
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
