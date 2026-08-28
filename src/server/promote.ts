import { copyFile, rename, unlink } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { notifyPlayers } from "./notify.ts";
import type { ArrKind, ExecutablePlan, LibraryItem, PlayerKind } from "./types.ts";

export type PromoteInput = {
  item: LibraryItem;
  outputPath: string;
  sourceSize: number;
  outputSize: number;
  plan?: ExecutablePlan;
  decrypt: (packed: string) => string;
  fetch: typeof fetch;
  instance?: { kind: ArrKind | PlayerKind | string; url: string; secret: string | null } | null;
  players: Array<{ kind: "plex" | "jellyfin"; url: string; token: string }>;
};

export type PromoteResult = {
  replaced: boolean;
  destPath: string;
  savedBytes: number;
  warning: string | null;
  error: string | null;
};

export async function replaceLibraryFile(outputPath: string, destPath: string, originalPath = destPath): Promise<void> {
  const dir = dirname(destPath);
  const staged = join(dir, `${Date.now()}-${Math.random().toString(16).slice(2)}.opt-new`);
  const backup = `${destPath}.opt-old`;
  await copyFile(outputPath, staged);
  try {
    await rename(destPath, backup);
  } catch {
    // Destination may be a new extension that does not exist yet.
  }
  try {
    await rename(staged, destPath);
  } catch (error) {
    try {
      await rename(backup, destPath);
    } catch {
      // Best effort restore.
    }
    await unlink(staged).catch(() => undefined);
    throw error;
  }
  await unlink(backup).catch(() => undefined);
  if (outputPath !== destPath) await unlink(outputPath).catch(() => undefined);
  if (originalPath !== destPath) await unlink(originalPath).catch(() => undefined);
}

export function promotedPath(sourcePath: string, plan?: ExecutablePlan): string {
  if (!plan || plan.container !== "mkv") return sourcePath;
  if (extname(sourcePath).toLowerCase() === ".mkv") return sourcePath;
  return sourcePath.replace(/\.[^.]+$/, ".mkv");
}

export async function promote(input: PromoteInput): Promise<PromoteResult> {
  const destPath = promotedPath(input.item.path, input.plan);
  try {
    await replaceLibraryFile(input.outputPath, destPath, input.item.path);
  } catch (error) {
    return {
      replaced: false,
      destPath,
      savedBytes: 0,
      warning: null,
      error: error instanceof Error ? error.message : "Keep could not replace the library file.",
    };
  }
  const playerErrors = await notifyPlayers(input.players, input.fetch);
  const warning = playerErrors.length ? playerErrors.join(" ") : null;
  return {
    replaced: true,
    destPath,
    savedBytes: Math.max(0, input.sourceSize - input.outputSize),
    warning,
    error: null,
  };
}
