import { z } from "zod";
import { requestItemStatusSchema } from "./request.ts";

/**
 * Thread-shaped inbox wire contract: one thread per engagement's outbound request, with one line
 * per request item — never one line per uploaded file. The server builds `/api/inbox` through
 * these schemas and the inbox page parses the same objects back out.
 */

const countSchema = z.number().int().nonnegative();

export const inboxThreadItemSchema = z.object({
  /** Request item id. */
  id: z.string().min(1),
  title: z.string().min(1),
  status: requestItemStatusSchema,
  waiveNote: z.string().max(500).optional(),
  /** Latest linked document when received/needs-attention — the `/documents/:id` deep link. */
  documentId: z.string().min(1).optional(),
  documentFilename: z.string().min(1).optional(),
  lastUpdateAt: z.string().datetime(),
});
export type InboxThreadItem = z.infer<typeof inboxThreadItemSchema>;

export const inboxThreadSchema = z.object({
  engagementId: z.string().min(1),
  clientName: z.string().min(1),
  /** "{filingType} · {taxYear}" — display-ready so the page never re-derives it. */
  engagementLabel: z.string().min(1),
  portalToken: z.string().min(1),
  /** The request-sent activity time, falling back to engagement creation. */
  requestSentAt: z.string().datetime(),
  /** True when any of the engagement's visible (non-internal) activities lacks a readAt. */
  unread: z.boolean(),
  unreadCount: countSchema,
  items: z.array(inboxThreadItemSchema),
  /** Latest sent-to-engine activity time — the compact thread footer line. */
  sentToEngineAt: z.string().datetime().optional(),
});
export type InboxThread = z.infer<typeof inboxThreadSchema>;

export const inboxThreadsResponseSchema = z.object({
  threads: z.array(inboxThreadSchema),
});
