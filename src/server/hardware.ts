import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HardwareBackend, HardwareInfo } from "./types.ts";

const execFileAsync = promisify(execFile);

export type HardwareProbe = () => Promise<HardwareInfo>;

export function parseEncoders(text: string): HardwareInfo {
  const lower = text.toLowerCase();
  const cuda = /\b(hevc_nvenc|h264_nvenc)\b/.test(lower);
  const vaapi = /\b(hevc_vaapi|h264_vaapi)\b/.test(lower);
  const av1 = /\b(av1_nvenc|av1_vaapi|av1_qsv)\b/.test(lower);
  const backend: HardwareBackend = cuda ? "cuda" : vaapi ? "vaapi" : "none";
  return {
    backend,
    cuda,
    vaapi,
    av1,
    reason: backend === "none" ? "No CUDA or VAAPI hardware encoder is visible to ffmpeg." : null,
  };
}

export function detectHardware(ffmpeg = "ffmpeg"): HardwareProbe {
  return async () => {
    try {
      const { stderr, stdout } = await execFileAsync(ffmpeg, ["-hide_banner", "-encoders"], { timeout: 8000 });
      return parseEncoders(`${stdout}\n${stderr}`);
    } catch (error) {
      return {
        backend: "none",
        cuda: false,
        vaapi: false,
        av1: false,
        reason: error instanceof Error ? error.message : "ffmpeg is not available.",
      };
    }
  };
}
