import { describe, expect, it } from "vitest";
import { chooseBackend, parseEncoders } from "./hardware.ts";

const jellyfinBoth = `
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 V..... av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)
 V..... h264_vaapi           H.264 (VAAPI) (codec h264)
 V..... hevc_vaapi           H.265/HEVC (VAAPI) (codec hevc)
 V..... av1_vaapi            AV1 (VAAPI) (codec av1)
 V..... av1_qsv              AV1 (Intel Quick Sync Video acceleration) (codec av1)
`;

const hevcOnly = `
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
`;

describe("hardware encoder listing", () => {
  it("marks NVIDIA AV1 when av1_nvenc is listed", () => {
    const encoders = parseEncoders(jellyfinBoth);
    expect(encoders.nvenc).toBe(true);
    expect(encoders.vaapi).toBe(true);
    expect(encoders.nvencAv1).toBe(true);
    expect(encoders.vaapiAv1).toBe(true);
  });

  it("hides AV1 when only HEVC NVENC is listed", () => {
    const encoders = parseEncoders(hevcOnly);
    expect(encoders.nvenc).toBe(true);
    expect(encoders.nvencAv1).toBe(false);
  });
});

describe("hardware backend choice", () => {
  it("uses VAAPI when ffmpeg lists NVENC but the container has no NVIDIA device", () => {
    const hw = chooseBackend(parseEncoders(jellyfinBoth), {
      nvidia: false,
      vaapi: true,
      vaapiDevice: "/dev/dri/renderD128",
    });
    expect(hw.backend).toBe("vaapi");
    expect(hw.cuda).toBe(false);
    expect(hw.vaapi).toBe(true);
    expect(hw.av1).toBe(true);
    expect(hw.vaapiDevice).toBe("/dev/dri/renderD128");
    expect(hw.reason).toBeNull();
  });

  it("uses CUDA when an NVIDIA device is visible", () => {
    const hw = chooseBackend(parseEncoders(jellyfinBoth), {
      nvidia: true,
      vaapi: true,
      vaapiDevice: "/dev/dri/renderD128",
    });
    expect(hw.backend).toBe("cuda");
    expect(hw.cuda).toBe(true);
    expect(hw.av1).toBe(true);
  });

  it("fails closed when encoders are listed but no GPU device is visible", () => {
    const hw = chooseBackend(parseEncoders(jellyfinBoth), { nvidia: false, vaapi: false, vaapiDevice: null });
    expect(hw.backend).toBe("none");
    expect(hw.reason).toMatch(/no NVIDIA device/i);
  });
});
