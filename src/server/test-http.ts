export async function waitForQueue(
  app: { request: (path: string, init?: RequestInit) => Promise<Response> },
  cookie: string,
  pred: (items: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 2000,
): Promise<Array<Record<string, unknown>>> {
  const start = Date.now();
  let items: Array<Record<string, unknown>> = [];
  while (Date.now() - start < timeoutMs) {
    const body = (await app.request("/api/queue", { headers: { cookie } }).then((r) => r.json())) as {
      items?: Array<Record<string, unknown>>;
    };
    items = body.items ?? [];
    if (pred(items)) return items;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`queue wait timed out; last statuses: ${items.map((j) => j.status).join(",")}`);
}

export async function waitForReview(
  app: { request: (path: string, init?: RequestInit) => Promise<Response> },
  cookie: string,
  pred: (items: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 2000,
): Promise<Array<Record<string, unknown>>> {
  const start = Date.now();
  let items: Array<Record<string, unknown>> = [];
  while (Date.now() - start < timeoutMs) {
    const body = (await app.request("/api/review", { headers: { cookie } }).then((r) => r.json())) as {
      items?: Array<Record<string, unknown>>;
    };
    items = body.items ?? [];
    if (pred(items)) return items;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`review wait timed out; last statuses: ${items.map((j) => j.status).join(",")}`);
}

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
