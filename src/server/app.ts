import { Hono } from "hono";
import { cors } from "hono/cors";
import { healthRoutes } from "./routes/health.ts";
import { recordRoutes } from "./routes/records.ts";

export function createApp() {
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    }),
  );

  app.route("/api/health", healthRoutes);
  app.route("/api/records", recordRoutes);

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
