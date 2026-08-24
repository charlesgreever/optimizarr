import type { InspectState } from "./api";

export function inspectBannerView(inspect: InspectState | null, dismissedFailed: boolean): {
  inspecting: boolean;
  showFailed: boolean;
  pending: number;
  failed: number;
} {
  const inspecting = Boolean(inspect && (inspect.walking || inspect.pending > 0));
  const failed = inspect?.failed ?? 0;
  return {
    inspecting,
    showFailed: Boolean(!inspecting && failed > 0 && !dismissedFailed),
    pending: inspect?.pending ?? 0,
    failed,
  };
}
