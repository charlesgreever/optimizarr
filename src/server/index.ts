import { serve } from "@hono/node-server";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { Store, dataDirFromEnv } from "./store.ts";

const port = Number(process.env.PORT || 7373);
const host = process.env.HOST || "0.0.0.0";
const dataDir = dataDirFromEnv();
const webRoot = process.env.WEB_ROOT || join(process.cwd(), "dist/web");

const store = new Store(dataDir);
const app = createApp(store, { webRoot });

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Optimizarr listening on http://${info.address}:${info.port}`);
  console.log(`Data directory: ${dataDir}`);
});
