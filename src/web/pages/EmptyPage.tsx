import { useEffect, useState } from "react";
import type { EmptyList } from "../api";

type Props = {
  title: string;
  fallback: string;
  load: () => Promise<EmptyList>;
};

export function EmptyPage({ title, fallback, load }: Props) {
  const [message, setMessage] = useState(fallback);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    load()
      .then((data) => {
        if (live) setMessage(data.message || fallback);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [fallback, load]);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
        <p className="text-sm leading-6 text-zinc-400">{error ?? message}</p>
      </div>
    </section>
  );
}
