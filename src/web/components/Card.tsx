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
    <div className="rounded-2xl border border-gray-200 bg-white shadow-theme-sm dark:border-gray-800 dark:bg-white/[0.03]">
      {(title != null || actions != null) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          {title != null ? <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h2> : <span />}
          {actions}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </div>
  );
}
