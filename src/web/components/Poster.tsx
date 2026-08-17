import { useState } from "react";

type Props = {
  itemId: number;
  hasPoster?: boolean;
  alt: string;
  className?: string;
};

export function Poster({ itemId, hasPoster, alt, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  if (!hasPoster || failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-zinc-800 text-[10px] uppercase tracking-wide text-zinc-500 ${className}`}
        aria-hidden
      >
        No art
      </div>
    );
  }
  return (
    <img
      src={`/api/library/items/${itemId}/poster`}
      alt={alt}
      className={`shrink-0 bg-zinc-800 object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
