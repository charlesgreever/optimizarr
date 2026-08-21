import { trimUrl } from "./arr.ts";

export type PlayerNotify = {
  kind: "plex" | "jellyfin";
  url: string;
  token: string;
};

export async function notifyPlayers(players: PlayerNotify[], httpFetch: typeof fetch): Promise<string[]> {
  const errors: string[] = [];
  for (const player of players) {
    try {
      if (player.kind === "plex") {
        const res = await httpFetch(`${trimUrl(player.url)}/library/sections/all/refresh?X-Plex-Token=${encodeURIComponent(player.token)}`);
        if (!res.ok) errors.push(`Plex at ${player.url} returned HTTP ${res.status}.`);
      } else {
        const res = await httpFetch(`${trimUrl(player.url)}/Library/Refresh`, {
          method: "POST",
          headers: { "X-Emby-Token": player.token },
        });
        if (!res.ok) errors.push(`Jellyfin at ${player.url} returned HTTP ${res.status}.`);
      }
    } catch {
      errors.push(`${player.kind === "plex" ? "Plex" : "Jellyfin"} at ${player.url} could not be reached.`);
    }
  }
  return errors;
}

export async function testPlex(url: string, token: string, httpFetch: typeof fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await httpFetch(`${trimUrl(url)}/identity`, { headers: { "X-Plex-Token": token } });
    if (res.status === 401) return { ok: false, message: "Plex rejected this token." };
    if (!res.ok) return { ok: false, message: `Plex returned HTTP ${res.status}.` };
    return { ok: true };
  } catch {
    return { ok: false, message: "Optimizarr could not reach Plex." };
  }
}

export async function testJellyfin(url: string, token: string, httpFetch: typeof fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await httpFetch(`${trimUrl(url)}/System/Info`, { headers: { "X-Emby-Token": token } });
    if (res.status === 401) return { ok: false, message: "Jellyfin rejected this token." };
    if (!res.ok) return { ok: false, message: `Jellyfin returned HTTP ${res.status}.` };
    return { ok: true };
  } catch {
    return { ok: false, message: "Optimizarr could not reach Jellyfin." };
  }
}

export async function refreshArr(
  kind: "radarr" | "sonarr",
  url: string,
  apiKey: string,
  arrId: number,
  httpFetch: typeof fetch,
): Promise<string | null> {
  try {
    const path = kind === "radarr" ? `/api/v3/command` : `/api/v3/command`;
    const body = kind === "radarr"
      ? { name: "RefreshMovie", movieIds: [arrId] }
      : { name: "RefreshSeries", seriesId: arrId };
    const res = await httpFetch(`${trimUrl(url)}${path}`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return `The Arr refresh returned HTTP ${res.status}. The new file is already in place.`;
    return null;
  } catch {
    return "The Arr could not be reached after Keep. The new file is already in place.";
  }
}
