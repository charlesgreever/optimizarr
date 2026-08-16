import type { FetchLike } from "./arr.ts";
import type { ArrInstance, LibraryItem, PlayerInstance } from "./models.ts";

export type NotifyResult = { ok: boolean; target: string; error?: string };

export async function notifyArrRename(
  fetchImpl: FetchLike,
  instance: ArrInstance,
  item: LibraryItem,
): Promise<NotifyResult> {
  const body =
    instance.kind === "sonarr"
      ? { name: "RescanSeries", seriesId: item.seriesId ?? item.externalId }
      : { name: "RefreshMovie", movieIds: [item.externalId] };
  try {
    const res = await fetchImpl(`${instance.url}/api/v3/command`, {
      method: "POST",
      headers: { "X-Api-Key": instance.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, target: instance.name, error: `Arr rename HTTP ${res.status}` };
    return { ok: true, target: instance.name };
  } catch (err) {
    return { ok: false, target: instance.name, error: err instanceof Error ? err.message : "Arr notify failed" };
  }
}

export async function testPlayer(
  fetchImpl: FetchLike,
  player: PlayerInstance,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    if (player.kind === "plex") {
      const res = await fetchImpl(`${player.url}/identity`, {
        headers: { Accept: "application/json", "X-Plex-Token": player.token },
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: "Plex token was rejected" };
      if (!res.ok) return { ok: false, error: `Plex returned HTTP ${res.status}` };
      const text = await res.text();
      const version = text.match(/version="([^"]+)"/)?.[1] ?? text.match(/"version"\s*:\s*"([^"]+)"/)?.[1];
      return { ok: true, version };
    }
    const res = await fetchImpl(`${player.url}/System/Info`, {
      headers: { "X-Emby-Token": player.token },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Player token was rejected" };
    if (!res.ok) return { ok: false, error: `Player returned HTTP ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { Version?: string; ServerName?: string };
    return { ok: true, version: data.Version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

export async function notifyPlayer(fetchImpl: FetchLike, player: PlayerInstance): Promise<NotifyResult> {
  try {
    if (player.kind === "plex") {
      const res = await fetchImpl(`${player.url}/library/sections/all/refresh`, {
        headers: { "X-Plex-Token": player.token },
      });
      if (!res.ok) return { ok: false, target: player.name, error: `Plex HTTP ${res.status}` };
      return { ok: true, target: player.name };
    }
    const res = await fetchImpl(`${player.url}/Library/Refresh`, {
      method: "POST",
      headers: { "X-Emby-Token": player.token },
    });
    if (!res.ok) return { ok: false, target: player.name, error: `Player HTTP ${res.status}` };
    return { ok: true, target: player.name };
  } catch (err) {
    return { ok: false, target: player.name, error: err instanceof Error ? err.message : "Player notify failed" };
  }
}
