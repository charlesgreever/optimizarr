async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  health: () => req<{ ok: boolean }>("/api/health"),
  status: () => req<{ authenticated: boolean; firstRun: FirstRun }>("/api/auth/status"),
  setup: (username: string, password: string) => req("/api/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => req("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => req("/api/auth/logout", { method: "POST" }),
  settings: () => req<SettingsPayload>("/api/settings"),
  saveSettings: (body: Record<string, unknown>) => req("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  hardware: () => req<Hardware>("/api/hardware"),
  saveInstance: (body: Record<string, unknown>) => req("/api/integrations", { method: "POST", body: JSON.stringify(body) }),
  testInstance: (id: string) => req<{ ok: boolean; message?: string }>(`/api/integrations/${id}/test`, { method: "POST" }),
  deleteInstance: (id: string) => req(`/api/integrations/${id}`, { method: "DELETE" }),
  refresh: () => req<{ errors: string[] }>("/api/library/refresh", { method: "POST" }),
  movies: () => req<{ items: LibraryRow[] }>("/api/library/movies"),
  series: () => req<{ items: LibraryRow[] }>("/api/library/series"),
  inspect: () => req<InspectState>("/api/inspect/status"),
  errors: () => req<{ items: FileError[] }>("/api/errors"),
  suggestions: (q = "") => req<{ items: SuggestionRow[] }>(`/api/suggestions?q=${encodeURIComponent(q)}`),
  dismiss: (id: string) => req(`/api/suggestions/${id}/dismiss`, { method: "POST" }),
  queue: (body: Record<string, unknown>) => req("/api/queue", { method: "POST", body: JSON.stringify(body) }),
  jobs: () => req<{ items: JobRow[] }>("/api/jobs"),
  cancel: (id: string) => req(`/api/jobs/${id}/cancel`, { method: "POST" }),
  runNow: (id: string) => req(`/api/jobs/${id}/run-now`, { method: "POST" }),
  review: () => req<{ items: ReviewRow[] }>("/api/review"),
  keep: (id: string) => req(`/api/review/${id}/keep`, { method: "POST" }),
  keepSelected: (ids: string[]) => req("/api/review/keep-selected", { method: "POST", body: JSON.stringify({ ids }) }),
  discard: (id: string) => req(`/api/review/${id}/discard`, { method: "POST" }),
  history: () => req<{ items: HistoryRow[] }>("/api/history"),
  home: () => req<HomePayload>("/api/home"),
  search: (q: string) => req<{ items: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  force: (id: string) => req(`/api/library/items/${id}/force`, { method: "POST" }),
  stereo: (id: string) => req(`/api/library/items/${id}/stereo`, { method: "POST" }),
  exempt: (id: string, exempt: boolean) => req(`/api/library/items/${id}/exempt`, { method: "POST", body: JSON.stringify({ exempt }) }),
  optimizeShow: (instanceId: string, show: string) =>
    req(`/api/library/series/${instanceId}/${encodeURIComponent(show)}/optimize`, { method: "POST" }),
};

export type FirstRun = { hasAdmin: boolean; languageConfirmed: boolean; hasReviewPath: boolean; hasArr: boolean; complete: boolean };
export type Hardware = { backend: string; cuda: boolean; vaapi: boolean; av1: boolean; reason: string | null };
export type SettingsPayload = {
  preferredLanguage: string;
  languageConfirmed: boolean;
  reviewPath: string;
  sizeCaps: Record<string, number>;
  videoTarget: string;
  concurrency: number;
  conservativeMode: boolean;
  offPeakEnabled: boolean;
  offPeakStart: string;
  offPeakEnd: string;
  localAuthBypass: boolean;
  instances: Array<{ id: string; kind: string; name: string; url: string; enabled: boolean; hasApiKey?: boolean; hasToken?: boolean }>;
  firstRun: FirstRun;
};
export type LibraryRow = {
  id: string;
  instanceId: string;
  displayTitle: string;
  instanceName: string;
  type: "movie" | "episode";
  showTitle: string | null;
  quality: string;
  path: string;
  sizeBytes: number;
  sizeExempt: boolean;
  inspected: boolean;
  hasPoster: boolean;
  error: string | null;
  reasons: string[];
  suggestion: { id: string; actions: string[]; reasons: string[] } | null;
};
export type SuggestionRow = {
  id: string;
  itemId: string;
  displayTitle: string;
  instanceName?: string;
  reasons: string[];
  warning: string | null;
  estimatedSavingsBytes: number | null;
  now: { codec: string | null; quality: string | null; sizeBytes: number | null; sizePerHourGb: number | null };
  after: { codec: string | null; quality: string | null; sizeBytes: number | null; sizePerHourGb: number | null };
};
export type JobRow = { id: string; displayTitle: string; status: string; phase: string; progress: number; error: string | null };
export type ReviewRow = {
  id: string;
  displayTitle: string;
  status: string;
  flagged: boolean;
  flagReason: string | null;
  source: { codec: string | null; sizeBytes: number | null; sizePerHourGb: number | null; durationSec: number; tracks: string };
  sidecar: { codec: string | null; sizeBytes: number | null; sizePerHourGb: number | null; durationSec: number; tracks: string };
  error: string | null;
};
export type HistoryRow = { id: string; displayTitle: string; outcome: string; bytesSaved: number; createdAt: number };
export type HomePayload = {
  filesOptimized: number;
  spaceSavedBytes: number;
  suggestions: number;
  queued: number;
  review: number;
  errors: number;
  recent: HistoryRow[];
  status: string;
};
export type FileError = { itemId: string | null; path: string; fileName: string; displayTitle: string; reason: string };
export type InspectState = { walking: boolean; pending: number; inspected: number; failed: number };
export type SearchHit = { itemId: string; type: string; displayTitle: string; instanceName: string; href: string };

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}
