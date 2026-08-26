import type { ReactNode } from "react";

export function Card({
  title,
  actions,
  children,
  padded = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white">
      {(title != null || actions != null) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-5 py-4">
          {title != null ? <h2 className="text-base font-semibold text-ink">{title}</h2> : <span />}
          {actions}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </div>
  );
}
