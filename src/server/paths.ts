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

export function suggestReviewPath(paths: string[]): string | null {
  const roots = [...new Set(paths.filter(Boolean).map(mediaShareRoot).filter((p): p is string => Boolean(p)))];
  const root = roots.length === 1 ? roots[0] : commonDirectory(roots);
  if (!root) return null;
  if (root.endsWith("/optimizarr-review")) return root;
  return `${root}/optimizarr-review`;
}
