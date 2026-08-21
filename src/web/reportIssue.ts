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
  lines.push("Attach a screenshot on GitHub if one would help.");
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
