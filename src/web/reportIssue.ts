export type ReportKind = "bug" | "change";

export type ReportJob = {
  displayTitle: string;
  phase: string;
  progress: number;
  status: string;
};

export type ReportInspect = {
  pending: number;
  walking: boolean;
  failed: number;
};

export type ReportContext = {
  route: string;
  inspect?: ReportInspect | null;
  running?: ReportJob | null;
  screenshotNote?: string;
};

const REPO = "https://github.com/charlesgreever/optimizarr/issues/new";

export function scrubReportText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/\/mnt\/[^\s]+/g, "[path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .replace(/\b(api[_-]?key|token|password|secret)\b\s*[:=]\s*\S+/gi, "[redacted]");
}

export function buildReportIssueBody(ctx: ReportContext): string {
  const lines = [
    "## What I saw",
    "",
    "",
    "## What I wanted",
    "",
    "",
    "## Context",
    `- Route: ${scrubReportText(ctx.route || "/")}`,
  ];
  if (ctx.inspect && (ctx.inspect.walking || ctx.inspect.pending > 0 || ctx.inspect.failed > 0)) {
    lines.push(
      `- Inspect leftovers: ${ctx.inspect.pending}`,
      `- Inspect walking: ${ctx.inspect.walking ? "yes" : "no"}`,
      `- Inspect failed: ${ctx.inspect.failed}`,
    );
  }
  if (ctx.running && ctx.running.status === "running") {
    const pct = Math.round(ctx.running.progress * 100);
    lines.push(
      `- Running job: ${scrubReportText(ctx.running.displayTitle)} · ${scrubReportText(ctx.running.phase)} · ${pct}%`,
    );
  }
  lines.push("");
  lines.push(ctx.screenshotNote ?? "A screenshot was downloaded. Attach it to this issue.");
  return lines.join("\n");
}

export function buildReportIssueUrl(kind: ReportKind, ctx: ReportContext): string {
  const title = kind === "bug" ? "Bug: Optimizarr" : "Change request: Optimizarr";
  const labels = kind === "bug" ? "bug" : "enhancement";
  const params = new URLSearchParams({
    title,
    body: buildReportIssueBody(ctx),
    labels,
  });
  return `${REPO}?${params.toString()}`;
}

export function screenshotFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `optimizarr-report-${stamp}.png`;
}

export type ViewportBox = {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
};

export function viewportCrop(
  full: { width: number; height: number },
  view: ViewportBox,
): { sx: number; sy: number; sw: number; sh: number } {
  const alreadyViewport = full.height <= view.height + 2 && full.width <= view.width + 2;
  const sx = alreadyViewport ? 0 : Math.max(0, Math.min(Math.floor(view.scrollX), Math.max(0, full.width)));
  const sy = alreadyViewport ? 0 : Math.max(0, Math.min(Math.floor(view.scrollY), Math.max(0, full.height)));
  const sw = Math.max(1, Math.min(Math.floor(view.width), Math.max(1, full.width - sx)));
  const sh = Math.max(1, Math.min(Math.floor(view.height), Math.max(1, full.height - sy)));
  return { sx, sy, sw, sh };
}

export type AttachResult = { attached: true; url: string } | { attached: false };

export async function submitReport(
  kind: ReportKind,
  ctx: ReportContext,
  io: {
    capture: () => Promise<Blob>;
    attach?: (blob: Blob, filename: string) => Promise<AttachResult>;
    copy?: (blob: Blob) => Promise<boolean>;
    download: (blob: Blob, filename: string) => void;
    open: (url: string) => void;
  },
): Promise<void> {
  let screenshotNote = "A screenshot could not be captured.";
  try {
    const blob = await io.capture();
    const filename = screenshotFilename();
    const uploaded = io.attach ? await io.attach(blob, filename).catch((): AttachResult => ({ attached: false })) : { attached: false as const };
    if (uploaded.attached) {
      screenshotNote = `![Optimizarr viewport](${uploaded.url})`;
    } else {
      const copied = io.copy ? await io.copy(blob).catch(() => false) : false;
      if (copied) {
        screenshotNote = "A screenshot is on the clipboard. Paste it into this issue (Ctrl+V or Cmd+V).";
      } else {
        io.download(blob, filename);
        screenshotNote = "A screenshot was downloaded. Attach it to this issue.";
      }
    }
  } catch {
    screenshotNote = "A screenshot could not be captured.";
  }
  io.open(buildReportIssueUrl(kind, { ...ctx, screenshotNote }));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
  return true;
}

export async function attachScreenshot(blob: Blob, filename: string): Promise<AttachResult> {
  const pngBase64 = await blobToBase64(blob);
  const res = await fetch("/api/report/screenshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, pngBase64 }),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!data || typeof data !== "object") return { attached: false };
  const body = data as { attached?: unknown; url?: unknown };
  if (body.attached === true && typeof body.url === "string" && body.url.startsWith("https://github.com/user-attachments/")) {
    return { attached: true, url: body.url };
  }
  return { attached: false };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}
