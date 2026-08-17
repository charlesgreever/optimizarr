export type ArrKind = "radarr" | "sonarr";
export type PlayerKind = "plex" | "jellyfin" | "other";
export type ItemType = "movie" | "episode";
export type ExclusionKind = "path" | "profile" | "tag" | "title";

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
  seriesId: number | null;
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
  posterRemoteUrl?: string | null;
  tags: string[];
};

export type PublicLibraryItem = Omit<LibraryItem, "posterRemoteUrl"> & { hasPoster: boolean };

export function publicLibraryItem(item: LibraryItem): PublicLibraryItem {
  const { posterRemoteUrl, ...rest } = item;
  return { ...rest, hasPoster: Boolean(posterRemoteUrl) };
}

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

export function publicPlayerInstance(row: PlayerInstance): PublicPlayerInstance {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    hasToken: Boolean(row.token),
  };
}
