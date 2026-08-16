import { serve } from "@hono/node-server";
import { join } from "node:path";
import { ArrClient } from "./arr.ts";
import { createApp } from "./app.ts";
import { Store, dataDirFromEnv } from "./store.ts";
import { LibrarySync } from "./sync.ts";

const port = Number(process.env.PORT || 7373);
const host = process.env.HOST || "0.0.0.0";
const dataDir = dataDirFromEnv();
const webRoot = process.env.WEB_ROOT || join(process.cwd(), "dist/web");
const syncMs = Number(process.env.SYNC_INTERVAL_MS || 5 * 60 * 1000);

const store = new Store(dataDir);
const sync = new LibrarySync(store, new ArrClient());
const app = createApp(store, { webRoot, sync });
sync.start(syncMs);

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Optimizarr listening on http://${info.address}:${info.port}`);
  console.log(`Data directory: ${dataDir}`);
});
