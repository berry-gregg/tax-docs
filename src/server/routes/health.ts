import { Hono } from "hono";
import { healthResponseSchema } from "../../shared/schemas/health.ts";
import { getDb } from "../db/client.ts";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  let database: "connected" | "disconnected" = "disconnected";

  try {
    await getDb().command({ ping: 1 });
    database = "connected";
  } catch {
    database = "disconnected";
  }

  const payload = healthResponseSchema.parse({
    status: "ok",
    service: "tax-docs",
    database,
  });

  return c.json(payload);
});
