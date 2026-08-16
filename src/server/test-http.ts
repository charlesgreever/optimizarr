export function cookieHeader(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const parts =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie.call(headers)
      : [headers.get("set-cookie") ?? ""];
  return parts
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}
