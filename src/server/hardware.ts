import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HardwareBackend, HardwareInfo } from "./types.ts";

const execFileAsync = promisify(execFile);

export type HardwareProbe = () => Promise<HardwareInfo>;

export function detectHardware(ffmpeg = "ffmpeg"): HardwareProbe {
  return async () => {
    try {
      const { stderr, stdout } = await execFileAsync(ffmpeg, ["-hide_banner", "-encoders"], { timeout: 8000 });
      const text = `${stdout}\n${stderr}`.toLowerCase();
      const cuda = text.includes("hevc_nvenc") || text.includes("h264_nvenc");
      const vaapi = text.includes("hevc_vaapi") || text.includes("h264_vaapi");
      const av1 = text.includes("av1_nvenc") || text.includes("av1_vaapi") || text.includes("av1_qsv");
      const backend: HardwareBackend = cuda ? "cuda" : vaapi ? "vaapi" : "none";
      return {
        backend,
        cuda,
        vaapi,
        av1,
        reason: backend === "none" ? "No CUDA or VAAPI hardware encoder is visible to ffmpeg." : null,
      };
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
