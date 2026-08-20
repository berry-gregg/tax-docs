import { Hono } from "hono";
import { cors } from "hono/cors";
import { clientRoutes } from "./routes/clients.ts";
import { documentTypeRoutes } from "./routes/document-types.ts";
import { engagementRoutes } from "./routes/engagements.ts";
import { healthRoutes } from "./routes/health.ts";
import { recordRoutes } from "./routes/records.ts";
import { requestTemplateRoutes } from "./routes/request-templates.ts";

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
  app.route("/api/document-types", documentTypeRoutes);
  app.route("/api/request-templates", requestTemplateRoutes);
  app.route("/api/clients", clientRoutes);
  app.route("/api/engagements", engagementRoutes);

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
