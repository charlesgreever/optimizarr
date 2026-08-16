import { describe, expect, it } from "vitest";
import { detectBackends, pickEncoder } from "./hardware.ts";

describe("hardware detection", () => {
  it("does not treat NVIDIA env vars as a working GPU without a device node", () => {
    const backends = detectBackends(
      { NVIDIA_VISIBLE_DEVICES: "all", NVIDIA_DRIVER_CAPABILITIES: "compute,video,utility" },
      () => false,
    );
    expect(backends.cuda).toBe(false);
  });

  it("enables CUDA when the env and a device node are both present", () => {
    const backends = detectBackends({ NVIDIA_VISIBLE_DEVICES: "all" }, (path) => path === "/dev/nvidia0");
    expect(backends.cuda).toBe(true);
  });

  it("picks NVENC when CUDA is present and VAAPI when only VAAPI is present", () => {
    expect(pickEncoder({ cuda: true, vaapi: true, av1: false }, "hevc")).toBe("hevc_nvenc");
    expect(pickEncoder({ cuda: false, vaapi: true, av1: false }, "hevc")).toBe("hevc_vaapi");
    expect(() => pickEncoder({ cuda: false, vaapi: false, av1: false }, "hevc")).toThrow(/no CUDA or VAAPI/);
    expect(pickEncoder({ cuda: true, vaapi: false, av1: true }, "av1")).toBe("av1_nvenc");
  });
});
