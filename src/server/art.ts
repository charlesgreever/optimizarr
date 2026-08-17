import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike } from "./arr.ts";
import type { LibraryItem } from "./models.ts";

export function artCachePath(dataDir: string, itemId: number): string {
  return join(dataDir, "art", String(itemId));
}

export function sniffImageType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return "image/jpeg";
}

export async function loadOrFetchPoster(
  dataDir: string,
  item: Pick<LibraryItem, "id" | "posterRemoteUrl">,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<Buffer | null> {
  const dest = artCachePath(dataDir, item.id);
  if (existsSync(dest)) return readFileSync(dest);
  const url = item.posterRemoteUrl;
  if (!url) return null;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { "X-Api-Key": apiKey } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return null;
  mkdirSync(join(dataDir, "art"), { recursive: true });
  writeFileSync(dest, buf);
  return buf;
}
