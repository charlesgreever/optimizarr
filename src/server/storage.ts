import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, constants, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { mediaShareRoot } from "./paths.ts";
import type { CopyMode, PathMap, Settings } from "./types.ts";

const execFileAsync = promisify(execFile);

export type TransferMethod = "rename" | "ssh" | "clone" | "server" | "proxy";

export type TransferResult = {
  method: TransferMethod;
  bytes: number;
};

export type { CopyMode, PathMap };

export type StorageConfig = {
  copyMode: CopyMode;
  nasSshHost: string;
  nasSshUser: string;
  nasSshPort: number;
  nasSshIdentityFile: string;
  nasPathMaps: PathMap[];
};

export type DetectedMount = {
  kind: "cifs" | "nfs";
  host: string;
  share: string;
  localRoot: string;
  suggestedRemote: string;
};

export type SshTransfer = {
  host: string;
  user: string;
  port: number;
  identityFile?: string;
  remoteSrc: string;
  remoteDest: string;
};

export type StorageAdapters = {
  cloneFile?: (src: string, dest: string) => Promise<boolean>;
  serverCopy?: (src: string, dest: string) => Promise<boolean>;
  proxyCopy?: (src: string, dest: string) => Promise<void>;
  rename?: (src: string, dest: string) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
  stat?: (path: string) => Promise<{ size: number; dev: bigint | number }>;
  sshCopy?: (req: SshTransfer) => Promise<void>;
  sshMove?: (req: SshTransfer) => Promise<void>;
  readMounts?: () => string;
  fileExists?: (path: string) => boolean;
};

export type Transfer = {
  copy(src: string, dest: string): Promise<TransferResult>;
  move(src: string, dest: string): Promise<TransferResult>;
};

export function mapToRemote(localPath: string, maps: PathMap[]): string | null {
  const norm = normalizePath(localPath);
  let best: { remote: string; len: number } | null = null;
  for (const map of maps) {
    const root = normalizePath(map.localRoot).replace(/\/+$/, "") || "/";
    if (norm === root || norm.startsWith(`${root}/`)) {
      const rest = norm.slice(root.length);
      const remoteRoot = normalizePath(map.remoteRoot).replace(/\/+$/, "");
      const remote = `${remoteRoot}${rest}`;
      if (!best || root.length > best.len) best = { remote, len: root.length };
    }
  }
  return best?.remote ?? null;
}

export function suggestPathMaps(mounts: DetectedMount[], localPaths: string[]): PathMap[] {
  if (mounts.length) {
    return mounts.map((m) => ({ localRoot: m.localRoot, remoteRoot: m.suggestedRemote }));
  }
  const roots = [
    ...new Set(localPaths.filter(Boolean).map(mediaShareRoot).filter((p): p is string => Boolean(p))),
  ];
  return roots.map((localRoot) => ({ localRoot, remoteRoot: "/volume1/Plex" }));
}

export function parseNetworkMounts(procMounts: string): DetectedMount[] {
  const out: DetectedMount[] = [];
  for (const line of procMounts.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [spec, mount, fstype] = parts;
    const localRoot = unescapeMount(mount);
    if (fstype === "cifs" || fstype === "smb3") {
      const match = spec.match(/^\/\/([^/]+)\/(.+)$/);
      if (!match) continue;
      const share = unescapeMount(match[2]).split("/")[0];
      out.push({
        kind: "cifs",
        host: match[1],
        share,
        localRoot,
        suggestedRemote: `/volume1/${share}`,
      });
    } else if (fstype.startsWith("nfs")) {
      const match = spec.match(/^([^:]+):(.+)$/);
      if (!match) continue;
      const share = unescapeMount(match[2]);
      out.push({
        kind: "nfs",
        host: match[1],
        share,
        localRoot,
        suggestedRemote: share,
      });
    }
  }
  return out;
}

export function storageConfigFromSettings(settings: Settings, env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    copyMode: settings.copyMode,
    nasSshHost: settings.nasSshHost.trim() || env.OPTIMIZARR_NAS_SSH_HOST || "",
    nasSshUser: settings.nasSshUser.trim() || env.OPTIMIZARR_NAS_SSH_USER || "",
    nasSshPort: settings.nasSshPort || Number(env.OPTIMIZARR_NAS_SSH_PORT) || 22,
    nasSshIdentityFile:
      settings.nasSshIdentityFile.trim() || env.OPTIMIZARR_NAS_SSH_KEY || defaultIdentityPath(env),
    nasPathMaps: (settings.nasPathMaps ?? []).filter((m) => m.localRoot.trim() && m.remoteRoot.trim()),
  };
}

export function createStorage(config: StorageConfig, adapters: StorageAdapters = {}): Transfer {
  const impl = {
    cloneFile: adapters.cloneFile ?? defaultClone,
    serverCopy: adapters.serverCopy ?? defaultServerCopy,
    proxyCopy: adapters.proxyCopy ?? defaultProxyCopy,
    rename: adapters.rename ?? rename,
    unlink: adapters.unlink ?? unlink,
    mkdir: adapters.mkdir ?? ((dir: string) => mkdir(dir, { recursive: true }).then(() => undefined)),
    stat: adapters.stat ?? ((path: string) => stat(path).then((info) => ({ size: info.size, dev: info.dev }))),
    sshCopy: adapters.sshCopy ?? defaultSshCopy,
    sshMove: adapters.sshMove ?? defaultSshMove,
    readMounts: adapters.readMounts ?? defaultReadMounts,
    fileExists: adapters.fileExists,
  };

  function maps(): PathMap[] {
    if (config.nasPathMaps.length) return config.nasPathMaps;
    return parseNetworkMounts(impl.readMounts()).map((m) => ({
      localRoot: m.localRoot,
      remoteRoot: m.suggestedRemote,
    }));
  }

  function sshTarget(): { host: string; user: string; port: number; identityFile?: string } | null {
    const detected = parseNetworkMounts(impl.readMounts())[0];
    const host = config.nasSshHost || detected?.host || "";
    const user = config.nasSshUser;
    if (!host || !user) return null;
    const identityFile = config.nasSshIdentityFile;
    const exists = impl.fileExists ?? existsSync;
    return {
      host,
      user,
      port: config.nasSshPort || 22,
      identityFile: identityFile && exists(identityFile) ? identityFile : undefined,
    };
  }

  function remotePair(src: string, dest: string): { remoteSrc: string; remoteDest: string } | null {
    const known = maps();
    const remoteSrc = mapToRemote(src, known);
    const remoteDest = mapToRemote(dest, known);
    if (!remoteSrc || !remoteDest) return null;
    return { remoteSrc, remoteDest };
  }

  async function bytesOf(path: string): Promise<number> {
    try {
      return Number((await impl.stat(path)).size);
    } catch {
      return 0;
    }
  }

  async function ensureParent(dest: string): Promise<void> {
    await impl.mkdir(dirname(dest));
  }

  return {
    async copy(src, dest) {
      if (normalizePath(src) === normalizePath(dest)) {
        return { method: "rename", bytes: await bytesOf(src) };
      }
      await ensureParent(dest);
      const mode = config.copyMode;
      const pair = remotePair(src, dest);
      const ssh = sshTarget();

      if (mode !== "proxy" && mode !== "mount" && pair && ssh) {
        try {
          await impl.sshCopy({ ...ssh, ...pair });
          return { method: "ssh", bytes: await bytesOf(dest) || await bytesOf(src) };
        } catch (err) {
          if (mode === "ssh") throw err;
        }
      }
      if (mode === "ssh") {
        if (!ssh) throw new Error("NAS SSH host and user are required for on-NAS copies");
        if (!pair) throw new Error("Both paths must be on a mapped NAS share for SSH copy");
        await impl.sshCopy({ ...ssh, ...pair });
        return { method: "ssh", bytes: await bytesOf(dest) || await bytesOf(src) };
      }
      if (mode === "proxy") {
        await impl.proxyCopy(src, dest);
        return { method: "proxy", bytes: await bytesOf(dest) || await bytesOf(src) };
      }

      if (await impl.cloneFile(src, dest)) {
        return { method: "clone", bytes: await bytesOf(dest) || await bytesOf(src) };
      }
      if (mode !== "ssh" && (await impl.serverCopy(src, dest))) {
        return { method: "server", bytes: await bytesOf(dest) || await bytesOf(src) };
      }
      if (mode === "mount") {
        throw new Error("Kernel server-side copy is not available for these paths");
      }
      await impl.proxyCopy(src, dest);
      return { method: "proxy", bytes: await bytesOf(dest) || await bytesOf(src) };
    },

    async move(src, dest) {
      if (normalizePath(src) === normalizePath(dest)) {
        return { method: "rename", bytes: await bytesOf(src) };
      }
      await ensureParent(dest);
      try {
        await impl.rename(src, dest);
        return { method: "rename", bytes: await bytesOf(dest) };
      } catch (err) {
        if (!isExdev(err)) throw err;
      }
      const pair = remotePair(src, dest);
      const ssh = sshTarget();
      if (config.copyMode !== "proxy" && pair && ssh) {
        try {
          await impl.sshMove({ ...ssh, ...pair });
          return { method: "ssh", bytes: await bytesOf(dest) || await bytesOf(src) };
        } catch (sshErr) {
          if (config.copyMode === "ssh") throw sshErr;
        }
      }
      const copied = await this.copy(src, dest);
      await impl.unlink(src);
      return copied;
    },
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function unescapeMount(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)));
}

function isExdev(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EXDEV");
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function defaultIdentityPath(env: NodeJS.ProcessEnv): string {
  const configured = env.CONFIG_DIR || "/config";
  return `${configured.replace(/\/+$/, "")}/nas_id_ed25519`;
}

async function defaultClone(src: string, dest: string): Promise<boolean> {
  try {
    await copyFile(src, dest, constants.COPYFILE_FICLONE_FORCE);
    return true;
  } catch {
    return false;
  }
}

async function defaultServerCopy(src: string, dest: string): Promise<boolean> {
  try {
    await copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}

async function defaultProxyCopy(src: string, dest: string): Promise<void> {
  await copyFile(src, dest);
}

function sshArgs(req: SshTransfer, remoteCommand: string): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-p",
    String(req.port || 22),
  ];
  if (req.identityFile) args.push("-i", req.identityFile);
  args.push(`${req.user}@${req.host}`, remoteCommand);
  return args;
}

function remoteCopyScript(src: string, dest: string): string {
  const destDir = posixQuote(dirname(dest));
  const quotedSrc = posixQuote(src);
  const quotedDest = posixQuote(dest);
  return `mkdir -p -- ${destDir} && (cp --reflink=auto -- ${quotedSrc} ${quotedDest} || cp -- ${quotedSrc} ${quotedDest})`;
}

async function defaultSshCopy(req: SshTransfer): Promise<void> {
  await execFileAsync("ssh", sshArgs(req, remoteCopyScript(req.remoteSrc, req.remoteDest)), {
    timeout: 24 * 60 * 60 * 1000,
  });
}

async function defaultSshMove(req: SshTransfer): Promise<void> {
  const destDir = posixQuote(dirname(req.remoteDest));
  const script = `mkdir -p -- ${destDir} && mv -- ${posixQuote(req.remoteSrc)} ${posixQuote(req.remoteDest)}`;
  await execFileAsync("ssh", sshArgs(req, script), { timeout: 60 * 60 * 1000 });
}

function defaultReadMounts(): string {
  try {
    return readFileSync("/proc/mounts", "utf8");
  } catch {
    return "";
  }
}
