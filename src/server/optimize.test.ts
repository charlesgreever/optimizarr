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
    expect(args).toContain("-progress");
    expect(args).toContain("pipe:1");
  });

  it("reports remux progress from ffmpeg out_time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-prog-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    writeFileSync(
      ffmpeg,
      `#!/usr/bin/env node
const fs = require("node:fs");
const dest = process.argv[process.argv.length - 1];
process.stdout.write("out_time_ms=5000\\nprogress=continue\\n");
fs.mkdirSync(require("node:path").dirname(dest), { recursive: true });
fs.writeFileSync(dest, "MEDIA");
`,
    );
    chmodSync(ffmpeg, 0o755);
    const source = join(dir, "movie.mkv");
    const sidecar = join(dir, "review", "show.1.mkv");
    writeFileSync(source, "MEDIA");
    const updates: Array<{ phase: string; progress: number }> = [];
    await ffmpegOptimizer(ffmpeg)({
      sourcePath: source,
      sidecarPath: sidecar,
      plan: { actions: ["remux"], keepAudio: ["eng"], keepSubs: [], category: "tv1080p" } as never,
      report: { durationSec: 10, sizeBytes: 5, videoCodec: "hevc" } as never,
      onProgress: (update) => updates.push({ phase: update.phase, progress: update.progress }),
    });
    expect(updates.some((u) => u.phase === "remuxing" && u.progress === 0.5)).toBe(true);
    expect(updates.some((u) => u.phase === "finishing")).toBe(true);
    expect(updates.every((u) => u.phase !== "remuxing" || u.progress < 1)).toBe(true);
  });

  it("finishes an encode when ffmpeg writes more than 1MB of decoder warnings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-nal-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    writeFileSync(
      ffmpeg,
      `#!/usr/bin/env node
const fs = require("node:fs");
const dest = process.argv[process.argv.length - 1];
process.stderr.write("Skipping NAL unit 63\\n".repeat(80000));
fs.mkdirSync(require("node:path").dirname(dest), { recursive: true });
fs.writeFileSync(dest, "MEDIA");
`,
    );
    chmodSync(ffmpeg, 0o755);
    const source = join(dir, "movie.mkv");
    const sidecar = join(dir, "review", "American_Underdog.476.mkv");
    writeFileSync(source, "MEDIA");
    const result = await ffmpegOptimizer(ffmpeg)({
      sourcePath: source,
      sidecarPath: sidecar,
      plan: { actions: ["remux"], keepAudio: ["eng", "eng", "eng", "eng", "eng"], keepSubs: [], category: "movie4kHdr" } as never,
      report: { durationSec: 10, sizeBytes: 5, videoCodec: "hevc" } as never,
    });
    expect(result.sidecarPath).toBe(sidecar);
    expect(readFileSync(sidecar, "utf8")).toBe("MEDIA");
  });

  it("maps each preferred language once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-map-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    const argsLog = join(dir, "args.txt");
    writeFileSync(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsLog}"\nexit 1\n`);
    chmodSync(ffmpeg, 0o755);
    writeFileSync(join(dir, "movie.mkv"), "MEDIA");
    await ffmpegOptimizer(ffmpeg)({
      sourcePath: join(dir, "movie.mkv"),
      sidecarPath: join(dir, "out.mkv"),
      plan: {
        actions: ["transcode"],
        keepAudio: ["eng", "eng", "eng", "eng", "eng"],
        keepSubs: ["eng", "eng", "eng"],
        category: "movie4kHdr",
      } as never,
      report: { durationSec: 10, sizeBytes: 5, videoCodec: "hevc" } as never,
      backends: { cuda: true, vaapi: false, av1: false },
    }).catch(() => undefined);
    const args = readFileSync(argsLog, "utf8");
    expect(args.split("0:a:m:language:eng").length - 1).toBe(1);
    expect(args.split("0:s:m:language:eng").length - 1).toBe(1);
  });

  it("remuxes extra tracks first then transcodes the remuxed file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-combo-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    const ffprobe = join(dir, "ffprobe");
    const argsLog = join(dir, "args.txt");
    writeFileSync(
      ffmpeg,
      `#!/usr/bin/env node
const fs = require("node:fs");
const dest = process.argv[process.argv.length - 1];
fs.appendFileSync(${JSON.stringify(argsLog)}, process.argv.slice(2).join(" ") + "\\n---\\n");
fs.mkdirSync(require("node:path").dirname(dest), { recursive: true });
fs.writeFileSync(dest, "MEDIA");
`,
    );
    writeFileSync(
      ffprobe,
      `#!/bin/sh
echo '{"format":{"duration":"10","size":"5"},"streams":[{"codec_type":"video","codec_name":"hevc","width":1920,"height":1080}]}'
`,
    );
    chmodSync(ffmpeg, 0o755);
    chmodSync(ffprobe, 0o755);
    const source = join(dir, "movie.mkv");
    const sidecar = join(dir, "review", "Night_Monster.436.mkv");
    writeFileSync(source, "ORIGINAL");
    const prevProbe = process.env.FFPROBE;
    process.env.FFPROBE = ffprobe;
    const updates: Array<{ phase: string }> = [];
    try {
      await ffmpegOptimizer(ffmpeg)({
        sourcePath: source,
        sidecarPath: sidecar,
        plan: {
          actions: ["remux", "transcode"],
          keepAudio: ["eng"],
          stripAudio: ["spa"],
          keepSubs: ["eng"],
          stripSubs: ["spa"],
          category: "movie1080p",
        } as never,
        report: {
          durationSec: 10,
          sizeBytes: 8,
          videoCodec: "h264",
          audio: [{ language: "eng" }, { language: "spa" }],
          subtitles: [{ language: "spa" }, { language: "eng" }],
        } as never,
        backends: { cuda: true, vaapi: false, av1: false },
        onProgress: (update) => updates.push({ phase: update.phase }),
      });
    } finally {
      if (prevProbe === undefined) delete process.env.FFPROBE;
      else process.env.FFPROBE = prevProbe;
    }
    const passes = readFileSync(argsLog, "utf8").split("---\n").filter((block) => block.trim());
    expect(passes).toHaveLength(2);
    expect(passes[0]).toContain(source);
    expect(passes[0]).toContain("-c copy");
    expect(passes[0]).not.toContain("hevc_nvenc");
    expect(passes[0]).toContain("0:a:m:language:eng");
    expect(passes[0]).not.toContain("0:a:m:language:spa");
    expect(passes[0]).toContain(".remux.tmp.mkv");
    expect(passes[1]).toContain("hevc_nvenc");
    expect(passes[1]).toContain(".remux.tmp.mkv");
    expect(passes[1]).not.toContain(`-i ${source}`);
    expect(updates.some((u) => u.phase === "remuxing")).toBe(true);
    expect(updates.some((u) => u.phase === "transcoding")).toBe(true);
    expect(updates.findIndex((u) => u.phase === "remuxing")).toBeLessThan(
      updates.findIndex((u) => u.phase === "transcoding"),
    );
    expect(readFileSync(sidecar, "utf8")).toBe("MEDIA");
  });

  it("keeps the first untagged audio instead of mapping every track", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-und-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    const argsLog = join(dir, "args.txt");
    writeFileSync(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsLog}"\nexit 1\n`);
    chmodSync(ffmpeg, 0o755);
    writeFileSync(join(dir, "movie.mkv"), "MEDIA");
    await ffmpegOptimizer(ffmpeg)({
      sourcePath: join(dir, "movie.mkv"),
      sidecarPath: join(dir, "out.mkv"),
      plan: {
        actions: ["transcode"],
        keepAudio: ["und"],
        stripAudio: [],
        keepSubs: [],
        stripSubs: [],
        category: "movie1080p",
      } as never,
      report: {
        durationSec: 10,
        sizeBytes: 5,
        videoCodec: "h264",
        audio: [{ language: undefined }],
        subtitles: [],
      } as never,
      backends: { cuda: true, vaapi: false, av1: false },
    }).catch(() => undefined);
    const args = readFileSync(argsLog, "utf8");
    expect(args).toContain("0:a:0");
    expect(args).not.toContain("0:a?");
  });

  it("adds stereo after the original audio instead of duplicating TrueHD", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opt-stereo-"));
    dirs.push(dir);
    const ffmpeg = join(dir, "ffmpeg");
    const argsLog = join(dir, "args.txt");
    writeFileSync(ffmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsLog}"\nexit 1\n`);
    chmodSync(ffmpeg, 0o755);
    writeFileSync(join(dir, "movie.mkv"), "MEDIA");
    await ffmpegOptimizer(ffmpeg)({
      sourcePath: join(dir, "movie.mkv"),
      sidecarPath: join(dir, "out.mkv"),
      plan: {
        actions: ["transcode", "add_stereo"],
        keepAudio: ["eng"],
        stripAudio: [],
        keepSubs: ["eng"],
        stripSubs: [],
        category: "movie4kHdr",
      } as never,
      report: {
        durationSec: 10,
        sizeBytes: 20,
        videoCodec: "hevc",
        audio: [
          { language: "eng", codec: "truehd", channels: 8, atmos: true },
          { language: "eng", codec: "ac3", channels: 6 },
        ],
        subtitles: [{ language: "eng" }],
      } as never,
      backends: { cuda: true, vaapi: false, av1: false },
    }).catch(() => undefined);
    const args = readFileSync(argsLog, "utf8").trim().split("\n");
    expect(args.filter((a) => a === "0:a:m:language:eng")).toHaveLength(1);
    expect(args.filter((a) => a === "0:a:0")).toHaveLength(1);
    expect(args).toContain("-c:a:2");
    expect(args).toContain("-ac:a:2");
    expect(args).toContain("-b:a:2");
    expect(args).not.toContain("-c:a:1");
  });
});
