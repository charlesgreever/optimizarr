import type { FetchLike } from "./arr.ts";
import type { ArrInstance, LibraryItem, PlayerInstance } from "./models.ts";

export type NotifyResult = { ok: boolean; target: string; error?: string };

export async function notifyArrRename(
  fetchImpl: FetchLike,
  instance: ArrInstance,
  item: LibraryItem,
): Promise<NotifyResult> {
  const name = instance.kind === "sonarr" ? "RenameFiles" : "Rename";
  const body =
    instance.kind === "sonarr"
      ? { name: "RescanSeries", seriesId: item.externalId }
      : { name: "RefreshMovie", movieIds: [item.externalId] };
  try {
    const res = await fetchImpl(`${instance.url}/api/v3/command`, {
      method: "POST",
      headers: { "X-Api-Key": instance.apiKey, "content-type": "application/json" },
      body: JSON.stringify(instance.kind === "sonarr" ? body : { name, movieIds: [item.externalId] }),
    });
    if (!res.ok) return { ok: false, target: instance.name, error: `Arr rename HTTP ${res.status}` };
    return { ok: true, target: instance.name };
  } catch (err) {
    return { ok: false, target: instance.name, error: err instanceof Error ? err.message : "Arr notify failed" };
  }
}

export async function notifyPlayer(fetchImpl: FetchLike, player: PlayerInstance): Promise<NotifyResult> {
  try {
    if (player.kind === "plex") {
      const url = `${player.url}/library/sections/all/refresh?X-Plex-Token=${encodeURIComponent(player.token)}`;
      const res = await fetchImpl(url);
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
