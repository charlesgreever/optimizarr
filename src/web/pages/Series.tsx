import { useEffect, useState } from "react";
import { api, type LibraryItem } from "../api";

export function Series() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.series().then((d) => {
      setItems((d.items as LibraryItem[]) ?? []);
      setMessage(d.message || "");
    });
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Series</h1>
      {items.length === 0 ? (
        <div className="mt-8 max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-sm text-zinc-400">
          {message || "Connect Sonarr in Settings to sync your library."}
        </div>
      ) : (
        <ul className="mt-6 space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-zinc-800 px-4 py-3">
              <div className="font-medium">{item.title}</div>
              <div className="text-zinc-500">
                {item.instanceName} · {item.videoCodec ?? "—"} · {item.path}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
