import { z } from "zod";

/**
 * One CPA↔client conversation message. Threads are keyed by engagement — the first outbound
 * message is the document request, and the portal + inbox exchange free text from there.
 */
export const messageSenderSchema = z.enum(["cpa", "client"]);

export const messageSchema = z.object({
  id: z.string().min(1),
  engagementId: z.string().min(1),
  sender: messageSenderSchema,
  body: z.string().min(1).max(2000),
  /** Stamped when the counterpart side has seen the message. Missing = unread. */
  readAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export type MessageSender = z.infer<typeof messageSenderSchema>;
export type Message = z.infer<typeof messageSchema>;
