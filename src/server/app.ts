import { Hono } from "hono";
import { cors } from "hono/cors";
import { noopRunner, type PipelineRunner } from "./pipeline/runner.ts";
import { clientRoutes } from "./routes/clients.ts";
import { documentTypeRoutes } from "./routes/document-types.ts";
import { createDocumentRoutes } from "./routes/documents.ts";
import { engagementRoutes } from "./routes/engagements.ts";
import { healthRoutes } from "./routes/health.ts";
import { inboxRoutes } from "./routes/inbox.ts";
import { metricsRoutes } from "./routes/metrics.ts";
import { createPortalRoutes } from "./routes/portal.ts";
import { recordRoutes } from "./routes/records.ts";
import { requestTemplateRoutes } from "./routes/request-templates.ts";

export function createApp(opts: { runner?: PipelineRunner } = {}) {
  const app = new Hono();
  const runner = opts.runner ?? noopRunner;

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
  app.route("/api/inbox", inboxRoutes);
  app.route("/api/metrics", metricsRoutes);
  app.route("/api/documents", createDocumentRoutes(runner));
  app.route("/api/portal", createPortalRoutes(runner));

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
