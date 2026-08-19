import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

function readText(name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readText(name)) as Record<string, unknown>;
}

export const mkvNormalFfprobe = readJson("mkv-normal.ffprobe.json");
export const mkv4kHdrFfprobe = readJson("mkv-4k-hdr.ffprobe.json");
export const isoListedFfmpeg = readText("iso-listed.ffmpeg.txt");
export const isoFailedFfmpeg = readText("iso-failed.ffmpeg.txt");
