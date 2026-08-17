import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyOptimizer, ffmpegOptimizer } from "./optimize.ts";
import type { Transfer } from "./storage.ts";

describe("storage-aware optimize", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("publishes a sidecar through the storage transfer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-"));
    dirs.push(dir);
    const source = join(dir, "movie.mkv");
    const sidecar = join(dir, "review", "movie.1.mkv");
    writeFileSync(source, "MEDIA");
    const methods: string[] = [];
    const transfer: Transfer = {
      copy: async (src, dest) => {
        methods.push(`copy ${src} -> ${dest}`);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(src));
        return { method: "ssh", bytes: 5 };
      },
      move: async () => ({ method: "rename", bytes: 5 }),
    };
    const result = await copyOptimizer()({
      sourcePath: source,
      sidecarPath: sidecar,
      plan: { actions: ["remux"], keepAudio: ["eng"], keepSubs: [], category: "movie1080p" },
      report: {
        durationSec: 10,
        sizeBytes: 5,
        videoCodec: "hevc",
        width: 1920,
        height: 1080,
        audio: [],
        subs: [],
      } as never,
      transfer,
    });
    expect(result.sidecarPath).toBe(sidecar);
    expect(readFileSync(sidecar, "utf8")).toBe("MEDIA");
    expect(methods.some((line) => line.includes(source) && line.includes(".tmp"))).toBe(true);
    expect(methods.some((line) => line.endsWith(`-> ${sidecar}`))).toBe(true);
  });
});

describe("transcode must not silently copy", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("fails the job instead of writing a same-size copy when ffmpeg cannot encode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-fail-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    writeFileSync(ffmpeg, "#!/bin/sh\necho 'Error initializing output stream: nvenc init failed' >&2\nexit 1\n");
    chmodSync(ffmpeg, 0o755);
    const source = join(dir, "movie.mkv");
    const sidecar = join(dir, "review", "American_Underdog.476.mkv");
    writeFileSync(source, "ORIGINAL-73GB-REMUX");
    await expect(
      ffmpegOptimizer(ffmpeg)({
        sourcePath: source,
        sidecarPath: sidecar,
        plan: {
          actions: ["transcode"],
          keepAudio: ["eng"],
          keepSubs: ["eng"],
          category: "movie4kHdr",
        } as never,
        report: { durationSec: 6728, sizeBytes: 18, videoCodec: "hevc" } as never,
        backends: { cuda: true, vaapi: false, av1: false },
      }),
    ).rejects.toThrow(/nvenc init failed/i);
    expect(existsSync(sidecar)).toBe(false);
  });

  it("asks ffmpeg to write a .mkv temp so the container format is not .tmp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-ext-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    const argsLog = join(dir, "args.txt");
    writeFileSync(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsLog}"\nexit 1\n`);
    chmodSync(ffmpeg, 0o755);
    const source = join(dir, "movie.mkv");
    const sidecar = join(dir, "review", "_I_Don_t_Want_to_Go_to_Chelsea.2409.mkv");
    writeFileSync(source, "MEDIA");
    await ffmpegOptimizer(ffmpeg)({
      sourcePath: source,
      sidecarPath: sidecar,
      plan: { actions: ["transcode"], keepAudio: ["eng"], keepSubs: [], category: "tv1080p" } as never,
      report: { durationSec: 10, sizeBytes: 5, videoCodec: "hevc" } as never,
      backends: { cuda: true, vaapi: false, av1: false },
    }).catch(() => undefined);
    const args = readFileSync(argsLog, "utf8").trim().split("\n");
    const output = args.at(-1) ?? "";
    expect(output.endsWith(".mkv")).toBe(true);
    expect(output.endsWith(".mkv.tmp")).toBe(false);
    expect(output).toContain(".tmp.mkv");
  });
});
