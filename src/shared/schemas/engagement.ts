import { z } from "zod";

export const filingTypeSchema = z.enum(["1120-S", "1065"]);
export type FilingType = z.infer<typeof filingTypeSchema>;

export const engagementStatusSchema = z.enum([
  "draft",
  "collecting",
  "in-review",
  "ready-to-export",
  "exported",
]);

export const engagementSchema = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  taxYear: z.number().int().min(2000).max(2100),
  filingType: filingTypeSchema,
  status: engagementStatusSchema,
  portalToken: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Engagement = z.infer<typeof engagementSchema>;

export const createEngagementInputSchema = engagementSchema.pick({
  clientId: true,
  taxYear: true,
  filingType: true,
});
