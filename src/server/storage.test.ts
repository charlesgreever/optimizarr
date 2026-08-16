import { describe, expect, it } from "vitest";
import {
  createStorage,
  mapToRemote,
  parseNetworkMounts,
  suggestPathMaps,
  type StorageAdapters,
  type StorageConfig,
} from "./storage.ts";

const maps = [{ localRoot: "/mnt/nas", remoteRoot: "/volume1/Plex" }];

const sshConfig: StorageConfig = {
  copyMode: "auto",
  nasSshHost: "192.168.1.5",
  nasSshUser: "cgreever",
  nasSshPort: 22,
  nasSshIdentityFile: "/config/nas_id_ed25519",
  nasPathMaps: maps,
};

function adapters(log: string[]): StorageAdapters {
  return {
    cloneFile: async () => {
      log.push("clone");
      return false;
    },
    serverCopy: async () => {
      log.push("server");
      return false;
    },
    proxyCopy: async (src, dest) => {
      log.push(`proxy ${src} -> ${dest}`);
    },
    rename: async (src, dest) => {
      log.push(`rename ${src} -> ${dest}`);
    },
    unlink: async (path) => {
      log.push(`unlink ${path}`);
    },
    mkdir: async () => undefined,
    stat: async () => ({ size: 40, dev: 1n }),
    sshCopy: async (req) => {
      log.push(`ssh ${req.remoteSrc} -> ${req.remoteDest}`);
    },
    sshMove: async (req) => {
      log.push(`ssh-mv ${req.remoteSrc} -> ${req.remoteDest}`);
    },
    readMounts: () => "",
  };
}

describe("NAS path mapping", () => {
  it("rewrites a library file onto the Synology volume path", () => {
    expect(mapToRemote("/mnt/nas/Movies/Up (2009)/Up.mkv", maps)).toBe(
      "/volume1/Plex/Movies/Up (2009)/Up.mkv",
    );
  });

  it("does not map a path outside the mount", () => {
    expect(mapToRemote("/var/scratch/movie.mkv", maps)).toBeNull();
  });

  it("suggests a Synology map from Arr paths when the container cannot see CIFS", () => {
    expect(
      suggestPathMaps([], ["/mnt/nas/Movies/Up.mkv", "/mnt/nas/optimizarr-review"]),
    ).toEqual([{ localRoot: "/mnt/nas", remoteRoot: "/volume1/Plex" }]);
  });

  it("reads CIFS and NFS mounts from /proc/mounts", () => {
    const mounts = parseNetworkMounts(
      [
        "//192.168.1.5/Plex /mnt/nas cifs rw,relatime,vers=3.1.1 0 0",
        "192.168.1.5:/volume1/Plex /mnt/other nfs4 rw 0 0",
        "/dev/sda1 / ext4 rw 0 0",
      ].join("\n"),
    );
    expect(mounts).toEqual([
      {
        kind: "cifs",
        host: "192.168.1.5",
        share: "Plex",
        localRoot: "/mnt/nas",
        suggestedRemote: "/volume1/Plex",
      },
      {
        kind: "nfs",
        host: "192.168.1.5",
        share: "/volume1/Plex",
        localRoot: "/mnt/other",
        suggestedRemote: "/volume1/Plex",
      },
    ]);
  });
});

describe("storage-aware copy", () => {
  it("copies on the NAS over SSH when both paths live on the mapped share", async () => {
    const log: string[] = [];
    const storage = createStorage(sshConfig, adapters(log));
    const result = await storage.copy(
      "/mnt/nas/Movies/Up.mkv",
      "/mnt/nas/optimizarr-review/Up.1.mkv",
    );
    expect(result).toEqual({ method: "ssh", bytes: 40 });
    expect(log).toEqual(["ssh /volume1/Plex/Movies/Up.mkv -> /volume1/Plex/optimizarr-review/Up.1.mkv"]);
  });

  it("does not pull a same-share copy through this host when SSH is available", async () => {
    const log: string[] = [];
    const storage = createStorage(sshConfig, adapters(log));
    await storage.copy("/mnt/nas/Movies/Up.mkv", "/mnt/nas/optimizarr-review/Up.1.mkv");
    expect(log.some((line) => line.startsWith("proxy"))).toBe(false);
    expect(log.some((line) => line === "server")).toBe(false);
  });

  it("uses a kernel server-side copy when SSH is not configured", async () => {
    const log: string[] = [];
    const storage = createStorage(
      { ...sshConfig, nasSshHost: "", nasSshUser: "" },
      {
        ...adapters(log),
        serverCopy: async () => {
          log.push("server");
          return true;
        },
      },
    );
    const result = await storage.copy(
      "/mnt/nas/Movies/Up.mkv",
      "/mnt/nas/optimizarr-review/Up.1.mkv",
    );
    expect(result.method).toBe("server");
    expect(log).toEqual(["clone", "server"]);
  });

  it("falls back to a proxied copy only when native copies fail", async () => {
    const log: string[] = [];
    const storage = createStorage(
      { ...sshConfig, nasSshHost: "", nasSshUser: "" },
      adapters(log),
    );
    const result = await storage.copy(
      "/mnt/nas/Movies/Up.mkv",
      "/mnt/nas/optimizarr-review/Up.1.mkv",
    );
    expect(result.method).toBe("proxy");
    expect(log.at(-1)).toBe(
      "proxy /mnt/nas/Movies/Up.mkv -> /mnt/nas/optimizarr-review/Up.1.mkv",
    );
  });

  it("never tries SSH for a copy off the NAS", async () => {
    const log: string[] = [];
    const storage = createStorage(
      sshConfig,
      {
        ...adapters(log),
        serverCopy: async () => {
          log.push("server");
          return true;
        },
      },
    );
    const result = await storage.copy("/mnt/nas/Movies/Up.mkv", "/var/scratch/Up.mkv");
    expect(result.method).toBe("server");
    expect(log.some((line) => line.startsWith("ssh"))).toBe(false);
  });

  it("honors proxy mode even when SSH is configured", async () => {
    const log: string[] = [];
    const storage = createStorage({ ...sshConfig, copyMode: "proxy" }, adapters(log));
    const result = await storage.copy(
      "/mnt/nas/Movies/Up.mkv",
      "/mnt/nas/optimizarr-review/Up.1.mkv",
    );
    expect(result.method).toBe("proxy");
    expect(log).toEqual(["proxy /mnt/nas/Movies/Up.mkv -> /mnt/nas/optimizarr-review/Up.1.mkv"]);
  });

  it("falls back from a failed SSH copy in auto mode", async () => {
    const log: string[] = [];
    const storage = createStorage(sshConfig, {
      ...adapters(log),
      sshCopy: async () => {
        log.push("ssh-fail");
        throw new Error("Permission denied");
      },
      serverCopy: async () => {
        log.push("server");
        return true;
      },
    });
    const result = await storage.copy(
      "/mnt/nas/Movies/Up.mkv",
      "/mnt/nas/optimizarr-review/Up.1.mkv",
    );
    expect(result.method).toBe("server");
    expect(log).toEqual(["ssh-fail", "clone", "server"]);
  });

  it("fails in ssh mode instead of silently proxying", async () => {
    const log: string[] = [];
    const storage = createStorage(
      { ...sshConfig, copyMode: "ssh", nasSshHost: "" },
      adapters(log),
    );
    await expect(
      storage.copy("/mnt/nas/Movies/Up.mkv", "/mnt/nas/optimizarr-review/Up.1.mkv"),
    ).rejects.toThrow(/ssh/i);
    expect(log.some((line) => line.startsWith("proxy"))).toBe(false);
  });
});

describe("storage-aware move", () => {
  it("renames in place when the kernel allows it", async () => {
    const log: string[] = [];
    const storage = createStorage(sshConfig, adapters(log));
    const result = await storage.move(
      "/mnt/nas/optimizarr-review/Up.1.mkv",
      "/mnt/nas/Movies/Up.mkv",
    );
    expect(result.method).toBe("rename");
    expect(log).toEqual([
      "rename /mnt/nas/optimizarr-review/Up.1.mkv -> /mnt/nas/Movies/Up.mkv",
    ]);
  });

  it("moves on the NAS over SSH when rename cannot cross the mount", async () => {
    const log: string[] = [];
    const err = Object.assign(new Error("EXDEV"), { code: "EXDEV" });
    const storage = createStorage(sshConfig, {
      ...adapters(log),
      rename: async () => {
        log.push("rename-fail");
        throw err;
      },
    });
    const result = await storage.move(
      "/mnt/nas/optimizarr-review/Up.1.mkv",
      "/mnt/nas/Movies/Up.mkv",
    );
    expect(result.method).toBe("ssh");
    expect(log).toEqual([
      "rename-fail",
      "ssh-mv /volume1/Plex/optimizarr-review/Up.1.mkv -> /volume1/Plex/Movies/Up.mkv",
    ]);
  });
});
