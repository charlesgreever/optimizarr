export type ArrKind = "radarr" | "sonarr";
export type PlayerKind = "plex" | "jellyfin" | "other";
export type ItemType = "movie" | "episode";

export type ArrInstance = {
  id: number;
  kind: ArrKind;
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
};

export type PublicArrInstance = Omit<ArrInstance, "apiKey"> & { hasApiKey: boolean };

export type PlayerInstance = {
  id: number;
  kind: PlayerKind;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
};

export type PublicPlayerInstance = Omit<PlayerInstance, "token"> & { hasToken: boolean };

export type LibraryItem = {
  id: number;
  instanceId: number;
  instanceName: string;
  instanceKind: ArrKind;
  externalId: number;
  type: ItemType;
  title: string;
  seriesTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  path: string;
  folderPath: string | null;
  quality: string | null;
  videoCodec: string | null;
  resolution: string | null;
  hdr: string | null;
  size: number | null;
  readable: boolean;
  pathError: string | null;
  updatedAt: string;
};

export function publicArrInstance(row: ArrInstance): PublicArrInstance {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    hasApiKey: Boolean(row.apiKey),
  };
}
