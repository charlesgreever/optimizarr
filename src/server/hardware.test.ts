import { describe, expect, it } from "vitest";
import { detectBackends } from "./hardware.ts";

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
});
