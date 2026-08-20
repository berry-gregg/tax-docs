import { z } from "zod";

export const activitySchema = z.object({
  id: z.string().min(1),
  engagementId: z.string().min(1),
  actor: z.enum(["agent", "cpa", "client"]),
  action: z.string().min(1),
  detail: z.string(),
  direction: z.enum(["inbound", "outbound", "internal"]),
  readAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type Activity = z.infer<typeof activitySchema>;
