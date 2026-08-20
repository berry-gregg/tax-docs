import { z } from "zod";
import { activitySchema } from "./activity.ts";

export const inboxEntrySchema = activitySchema.extend({
  clientName: z.string().min(1),
  portalToken: z.string().min(1).optional(),
  unread: z.boolean(),
});
export type InboxEntry = z.infer<typeof inboxEntrySchema>;

export const inboxUnreadCountSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type InboxUnreadCount = z.infer<typeof inboxUnreadCountSchema>;
