import { existsSync } from "node:fs";

export type EncodeBackends = {
  cuda: boolean;
  vaapi: boolean;
  av1: boolean;
};

export function detectBackends(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): EncodeBackends {
  const forced = env.OPTIMIZARR_BACKENDS;
  if (forced) {
    const parts = new Set(forced.split(",").map((s) => s.trim().toLowerCase()));
    return {
      cuda: parts.has("cuda"),
      vaapi: parts.has("vaapi"),
      av1: parts.has("av1"),
    };
  }
  return {
    cuda: exists("/dev/nvidia0") || exists("/dev/nvidiactl"),
    vaapi: Boolean(env.LIBVA_DRIVER_NAME) || exists("/dev/dri/renderD128"),
    av1: false,
  };
}

export function pickEncoder(backends: EncodeBackends, codec: "hevc" | "av1"): string {
  if (codec === "av1") {
    if (backends.av1 && backends.cuda) return "av1_nvenc";
    if (backends.av1 && backends.vaapi) return "av1_vaapi";
    throw new Error("Hardware encode failed: AV1 encode is not available on this device");
  }
  if (backends.cuda) return "hevc_nvenc";
  if (backends.vaapi) return "hevc_vaapi";
  throw new Error("Hardware encode failed: no CUDA or VAAPI device is available");
}

export function assertHardware(backends: EncodeBackends, codec: "hevc" | "av1"): void {
  pickEncoder(backends, codec);
}
