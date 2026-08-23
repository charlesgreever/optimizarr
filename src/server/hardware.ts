import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import type { HardwareBackend, HardwareInfo } from "./types.ts";

const execFileAsync = promisify(execFile);

export type HardwareProbe = () => Promise<HardwareInfo>;

export type EncoderListing = {
  nvenc: boolean;
  vaapi: boolean;
  nvencAv1: boolean;
  vaapiAv1: boolean;
};

export type EncodeDevices = {
  nvidia: boolean;
  vaapi: boolean;
  vaapiDevice: string | null;
};

export function parseEncoders(text: string): EncoderListing {
  const lower = text.toLowerCase();
  return {
    nvenc: /\b(hevc_nvenc|h264_nvenc)\b/.test(lower),
    vaapi: /\b(hevc_vaapi|h264_vaapi)\b/.test(lower),
    nvencAv1: /\bav1_nvenc\b/.test(lower),
    vaapiAv1: /\b(av1_vaapi|av1_qsv)\b/.test(lower),
  };
}

export function probeEncodeDevices(dirents: string[] | null = null): EncodeDevices {
  const nvidia = existsSync("/dev/nvidia0") || existsSync("/dev/nvidiactl");
  const names = dirents ?? listRenderNodes();
  const preferred = names.includes("renderD128") ? "renderD128" : names[0];
  const vaapiDevice = preferred ? `/dev/dri/${preferred}` : null;
  return { nvidia, vaapi: Boolean(vaapiDevice), vaapiDevice };
}

export function chooseBackend(encoders: EncoderListing, devices: EncodeDevices): HardwareInfo {
  const cuda = encoders.nvenc && devices.nvidia;
  const vaapi = encoders.vaapi && devices.vaapi;
  const backend: HardwareBackend = cuda ? "cuda" : vaapi ? "vaapi" : "none";
  return {
    backend,
    cuda,
    vaapi,
    av1: backend === "cuda" ? encoders.nvencAv1 : backend === "vaapi" ? encoders.vaapiAv1 : false,
    reason: noneReason(encoders, devices, backend),
    vaapiDevice: backend === "vaapi" ? devices.vaapiDevice : null,
  };
}

export function detectHardware(ffmpeg = "ffmpeg", devices: () => EncodeDevices = probeEncodeDevices): HardwareProbe {
  return async () => {
    try {
      const { stderr, stdout } = await execFileAsync(ffmpeg, ["-hide_banner", "-encoders"], { timeout: 8000 });
      return chooseBackend(parseEncoders(`${stdout}\n${stderr}`), devices());
    } catch (error) {
      return {
        backend: "none",
        cuda: false,
        vaapi: false,
        av1: false,
        reason: error instanceof Error ? error.message : "ffmpeg is not available.",
        vaapiDevice: null,
      };
    }
  };
}

function listRenderNodes(): string[] {
  try {
    return readdirSync("/dev/dri").filter((name) => name.startsWith("renderD")).sort();
  } catch {
    return [];
  }
}

function noneReason(encoders: EncoderListing, devices: EncodeDevices, backend: HardwareBackend): string | null {
  if (backend !== "none") return null;
  if (encoders.nvenc && !devices.nvidia) {
    return "ffmpeg lists NVIDIA encode, but no NVIDIA device is visible to this container.";
  }
  if (encoders.vaapi && !devices.vaapi) {
    return "ffmpeg lists VAAPI encode, but /dev/dri is not visible to this container.";
  }
  return "No CUDA or VAAPI hardware encoder is visible to ffmpeg.";
}
