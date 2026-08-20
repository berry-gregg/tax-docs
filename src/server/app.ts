import { Hono } from "hono";
import { cors } from "hono/cors";
import type { OpenRouterClient } from "./ai/openrouter.ts";
import { noopRunner, type PipelineRunner } from "./pipeline/runner.ts";
import { clientRoutes } from "./routes/clients.ts";
import { documentTypeRoutes } from "./routes/document-types.ts";
import { createDocumentRoutes } from "./routes/documents.ts";
import { engagementRoutes } from "./routes/engagements.ts";
import { exportRoutes } from "./routes/exports.ts";
import { healthRoutes } from "./routes/health.ts";
import { inboxRoutes } from "./routes/inbox.ts";
import { metricsRoutes } from "./routes/metrics.ts";
import { createPortalRoutes } from "./routes/portal.ts";
import { recordRoutes } from "./routes/records.ts";
import { requestTemplateRoutes } from "./routes/request-templates.ts";
import { searchRoutes } from "./routes/search.ts";

/**
 * Default for the routes that call a model directly. A test or a caller that never exercises
 * those routes should not have to build a client, but an unwired app must fail loudly rather
 * than reach OpenRouter with whatever key happens to be in the environment.
 */
const unavailableAi: OpenRouterClient = {
  completeStructured() {
    return Promise.reject(new Error("No AI client was provided to createApp"));
  },
};

export function createApp(opts: { runner?: PipelineRunner; ai?: OpenRouterClient } = {}) {
  const app = new Hono();
  const runner = opts.runner ?? noopRunner;
  const ai = opts.ai ?? unavailableAi;

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
  app.route("/api/exports", exportRoutes);
  app.route("/api/inbox", inboxRoutes);
  app.route("/api/metrics", metricsRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/documents", createDocumentRoutes(runner, ai));
  app.route("/api/portal", createPortalRoutes(runner));

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
}
