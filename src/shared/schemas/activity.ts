import { z } from "zod";

export const activitySchema = z.object({
  id: z.string().min(1),
  engagementId: z.string().min(1),
  actor: z.enum(["agent", "cpa", "client"]),
  action: z.string().min(1),
  detail: z.string(),
  direction: z.enum(["inbound", "outbound", "internal"]),
  /** Set on document lifecycle activities so inbox rows can deep-link without parsing activity ids. */
  documentId: z.string().min(1).optional(),
  readAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type Activity = z.infer<typeof activitySchema>;
