import { describe, expect, it } from "vitest";
import { parseEncoders } from "./hardware.ts";

const jellyfinNvenc = `
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
 V..... av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)
 V..... av1_qsv              AV1 (Intel Quick Sync Video acceleration) (codec av1)
`;

const hevcOnly = `
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
`;

describe("hardware encoder listing", () => {
  it("marks AV1 available when av1_nvenc is listed", () => {
    const hw = parseEncoders(jellyfinNvenc);
    expect(hw.cuda).toBe(true);
    expect(hw.av1).toBe(true);
    expect(hw.backend).toBe("cuda");
    expect(hw.reason).toBeNull();
  });

  it("hides AV1 when only HEVC NVENC is listed", () => {
    const hw = parseEncoders(hevcOnly);
    expect(hw.cuda).toBe(true);
    expect(hw.av1).toBe(false);
    expect(hw.backend).toBe("cuda");
  });
});
