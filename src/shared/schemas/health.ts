import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("tax-docs"),
  database: z.enum(["connected", "disconnected"]),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
