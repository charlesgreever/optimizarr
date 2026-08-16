const LIBRARY_DIR = /^(movies?|tv|television|series|shows|anime|kids|kids[ -]?movies|4k|uhd)$/i;

export function commonDirectory(paths: string[]): string | null {
  const parts = paths
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => p.replace(/\\/g, "/").split("/").filter(Boolean));
  if (parts.length === 0) return null;
  const prefix: string[] = [];
  for (let i = 0; ; i++) {
    const seg = parts[0][i];
    if (!seg || !parts.every((p) => p[i] === seg)) break;
    prefix.push(seg);
  }
  if (prefix.length === 0) return null;
  return `/${prefix.join("/")}`;
}

export function mediaShareRoot(path: string): string | null {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (LIBRARY_DIR.test(parts[i])) {
      return i === 0 ? `/${parts[0]}` : `/${parts.slice(0, i).join("/")}`;
    }
  }
  if (parts.length >= 2) return `/${parts.slice(0, -1).join("/")}`;
  return `/${parts.join("/")}`;
}

function normalizePath(path: string): string {
  const cleaned = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return cleaned || "/";
}

function libraryRoots(libraryPaths: string[]): string[] {
  const roots = new Set<string>();
  for (const raw of libraryPaths.filter(Boolean)) {
    const posix = raw.replace(/\\/g, "/");
    const parts = posix.split("/").filter(Boolean);
    const idx = parts.findIndex((seg) => LIBRARY_DIR.test(seg));
    if (idx >= 0) {
      roots.add(`/${parts.slice(0, idx + 1).join("/")}`);
      continue;
    }
    const dir = /\.[a-z0-9]{2,4}$/i.test(posix) ? posix.slice(0, posix.lastIndexOf("/")) : posix;
    if (dir && dir.split("/").filter(Boolean).length >= 3) roots.add(normalizePath(dir));
  }
  return [...roots];
}

export function reviewPathInsideLibrary(reviewPath: string, libraryPaths: string[]): boolean {
  const review = normalizePath(reviewPath);
  if (!review || review === "/") return false;
  return libraryRoots(libraryPaths).some((root) => review === root || review.startsWith(`${root}/`));
}

export function suggestReviewPath(paths: string[]): string | null {
  const roots = [...new Set(paths.filter(Boolean).map(mediaShareRoot).filter((p): p is string => Boolean(p)))];
  const root = roots.length === 1 ? roots[0] : commonDirectory(roots);
  if (!root) return null;
  if (root.endsWith("/optimizarr-review")) return root;
  return `${root}/optimizarr-review`;
}
