import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type Env = {
  configDir: string;
  port: number;
  host: string;
  puid: number;
  pgid: number;
  tz: string;
  ffmpeg: string;
  ffprobe: string;
  mkvmerge: string;
  webRoot: string;
  secretPath: string;
  dbPath: string;
  widgetKeyEnv: string | null;
  trustProxy: boolean;
};

export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  const configDir = processEnv.CONFIG_DIR ?? "./config";
  mkdirSync(configDir, { recursive: true });
  return {
    configDir,
    port: Number(processEnv.PORT ?? 7373),
    host: processEnv.HOST ?? "127.0.0.1",
    puid: Number(processEnv.PUID ?? 1000),
    pgid: Number(processEnv.PGID ?? 1000),
    tz: processEnv.TZ ?? "America/New_York",
    ffmpeg: processEnv.FFMPEG ?? "ffmpeg",
    ffprobe: processEnv.FFPROBE ?? "ffprobe",
    mkvmerge: processEnv.MKVMERGE ?? "mkvmerge",
    webRoot: processEnv.WEB_ROOT ?? join(dirname(new URL(import.meta.url).pathname), "../../dist/web"),
    secretPath: join(configDir, ".secret"),
    dbPath: join(configDir, "optimizarr.db"),
    widgetKeyEnv: processEnv.OPTIMIZARR_WIDGET_KEY ?? null,
    trustProxy: processEnv.OPTIMIZARR_TRUST_PROXY === "1",
  };
}
