import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { connectDb } from "./db/client.ts";

const app = createApp();

await connectDb();

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`API running at http://127.0.0.1:${server.port}`);
