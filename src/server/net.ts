const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
];

export function normalizeIp(raw: string | undefined): string {
  if (!raw) return "";
  let ip = raw.trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") return "127.0.0.1";
  return ip;
}

export function clientIp(
  headers: Headers,
  remoteAddress: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.OPTIMIZARR_TRUST_PROXY === "1") {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const ip = normalizeIp(forwarded.split(",")[0]);
      if (ip) return ip;
    }
    const real = headers.get("x-real-ip");
    if (real) {
      const ip = normalizeIp(real);
      if (ip) return ip;
    }
  }
  return normalizeIp(remoteAddress);
}

export function isPrivateIp(ip: string): boolean {
  const n = normalizeIp(ip);
  if (!n) return false;
  if (n === "127.0.0.1") return true;
  return PRIVATE_V4.some((re) => re.test(n));
}
