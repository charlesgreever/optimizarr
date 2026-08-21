export const REPORT_REPO = { owner: "charlesgreever", name: "optimizarr" };
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function decodePngBase64(value: string): Buffer {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 8 || bytes.subarray(0, 4).compare(PNG_SIG) !== 0) {
    throw new Error("Screenshot is not a PNG.");
  }
  if (bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new Error("Screenshot is too large to upload.");
  }
  return bytes;
}

export function safeScreenshotFilename(value: string | undefined): string {
  if (value && /^optimizarr-report-[\w.-]+\.png$/.test(value)) return value;
  return "optimizarr-report.png";
}

export async function uploadGithubIssueScreenshot(opts: {
  token: string;
  filename: string;
  png: Buffer;
  fetch: typeof fetch;
}): Promise<string> {
  const repoRes = await opts.fetch(`https://api.github.com/repos/${REPORT_REPO.owner}/${REPORT_REPO.name}`, {
    headers: githubHeaders(opts.token),
  });
  if (!repoRes.ok) throw new Error("GitHub rejected the repository lookup.");
  const repo = await readObject(repoRes);
  if (typeof repo.id !== "number") throw new Error("GitHub did not return a repository id.");

  const params = new URLSearchParams({
    name: opts.filename,
    content_type: "image/png",
    repository_id: String(repo.id),
  });
  const upload = await opts.fetch(`https://uploads.github.com/user-attachments/assets?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/json",
      "User-Agent": "optimizarr",
    },
    body: new Uint8Array(opts.png),
  });
  if (!upload.ok) throw new Error("GitHub rejected the screenshot upload.");
  const body = await readObject(upload);
  if (typeof body.url !== "string" || !body.url.startsWith("https://github.com/user-attachments/")) {
    throw new Error("GitHub did not return an attachment URL.");
  }
  return body.url;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "optimizarr",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readObject(res: Response): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
