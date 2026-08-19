import { serve } from "@hono/node-server";
import { loadEnv } from "./env.ts";
import { createApp } from "./app.ts";

const env = loadEnv();
const { app } = createApp({ env });

serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
  console.log(`Optimizarr is listening on http://${info.address}:${info.port}`);
});
