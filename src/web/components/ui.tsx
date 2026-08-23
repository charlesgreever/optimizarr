import type { ReactNode } from "react";
import { formatSize } from "../api";

const pillTone = {
  neutral: "border-white/10 bg-white/5 text-slate-300",
  good: "border-good/30 bg-good/10 text-good",
  warn: "border-warn/30 bg-warn/10 text-warn",
  bad: "border-bad/30 bg-bad/10 text-bad",
  accent: "border-accent/30 bg-accent/15 text-accent",
} as const;

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof pillTone;
}) {
  return (
    <span className={`inline-flex max-w-full truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${pillTone[tone]}`}>
      {children}
    </span>
  );
}

export function PillList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <span className="text-xs text-slate-500">{empty}</span>;
  }
  return (
    <div className="flex max-w-52 flex-wrap gap-1">
      {items.map((item, index) => (
        <Pill key={`${index}:${item}`}>{item}</Pill>
      ))}
    </div>
  );
}

export function FilterChip({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        pressed
          ? "border-accent/40 bg-accent/15 text-accent"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

type Snapshot = {
  codec: string | null;
  quality: string | null;
  sizeBytes: number | null;
  sizePerHourGb: number | null;
  tracks: string[];
};

export function MediaSnapshot({
  snapshot,
  savingsBytes,
  emphasize,
}: {
  snapshot: Snapshot;
  savingsBytes?: number | null;
  emphasize?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {snapshot.codec && <Pill tone={emphasize ? "accent" : "neutral"}>{snapshot.codec}</Pill>}
        {snapshot.quality && <Pill>{snapshot.quality}</Pill>}
        {snapshot.sizeBytes != null && (
          <span className="font-medium tabular-nums text-ink">{formatSize(snapshot.sizeBytes)}</span>
        )}
        {snapshot.sizePerHourGb != null && (
          <span className="text-xs tabular-nums text-muted">{snapshot.sizePerHourGb.toFixed(2)} GB/hr</span>
        )}
        {savingsBytes ? (
          <span className="text-xs font-medium text-good">save {formatSize(savingsBytes)}</span>
        ) : null}
      </div>
      {snapshot.tracks.length > 0 && (
        <div className="flex max-w-72 flex-wrap gap-1">
          {snapshot.tracks.map((track, index) => (
            <Pill key={`${index}:${track}`}>{track}</Pill>
          ))}
        </div>
      )}
    </div>
  );
}

export function VideoLabel({ label }: { label: string }) {
  if (label === "—" || label === "Unknown codec") {
    return <span className="text-xs text-slate-500">{label}</span>;
  }
  const [codec, detail] = label.split(" · ");
  return (
    <div className="leading-tight">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-200">{codec}</div>
      {detail && <div className="text-[11px] text-slate-400">{detail}</div>}
    </div>
  );
}

export function PlanStatus({ lines }: { lines: string[] }) {
  if (lines.length === 1 && lines[0] === "Healthy") {
    return <Pill tone="good">Healthy</Pill>;
  }
  if (lines[0] === "Waiting for inspect") {
    return <span className="text-xs text-warn">{lines[0]}</span>;
  }
  return (
    <ul className="max-w-64 space-y-1 text-xs leading-5 text-slate-300">
      {lines.map((line, index) => (
        <li key={`${index}:${line}`}>{line}</li>
      ))}
    </ul>
  );
}
