const PRIVATE = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^fc/,
  /^fd/,
];

export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  const host = address.replace(/^::ffff:/, "");
  return PRIVATE.some((re) => re.test(host)) || host === "localhost";
}

export function requestAddress(ip: string | undefined, forwarded: string | undefined, trustProxy: boolean): string {
  if (trustProxy && forwarded) {
    return forwarded.split(",")[0]?.trim() ?? ip ?? "";
  }
  return ip ?? "";
}
