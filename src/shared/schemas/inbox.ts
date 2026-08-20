import { z } from "zod";
import { pipelineStatusSchema } from "./document.ts";
import { filingTypeSchema } from "./engagement.ts";
import { messageSchema, messageSenderSchema } from "./message.ts";

/**
 * Conversation-shaped inbox wire contract: one thread per engagement, keyed by engagementId.
 * Messages (the messages collection) are the primary object; visible activities project into
 * quiet single-line `event` entries so uploads and matches read inside the conversation.
 * The server builds `/api/inbox` through these schemas and the inbox page parses them back out.
 */

const countSchema = z.number().int().nonnegative();

export const inboxMessageEntrySchema = z.object({
  kind: z.literal("message"),
  /** Message id from the messages collection. */
  id: z.string().min(1),
  sender: messageSenderSchema,
  body: messageSchema.shape.body,
  createdAt: z.string().datetime(),
});
export type InboxMessageEntry = z.infer<typeof inboxMessageEntrySchema>;

export const inboxEventEntrySchema = z.object({
  kind: z.literal("event"),
  /** Activity id the event was projected from. */
  id: z.string().min(1),
  /** Compact system line, e.g. "Client uploaded balance-sheet.pdf". */
  text: z.string().min(1),
  /** Present on document lifecycle events — the `/documents/:id` deep link. */
  documentId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
});
export type InboxEventEntry = z.infer<typeof inboxEventEntrySchema>;

export const inboxTimelineEntrySchema = z.discriminatedUnion("kind", [
  inboxMessageEntrySchema,
  inboxEventEntrySchema,
]);
export type InboxTimelineEntry = z.infer<typeof inboxTimelineEntrySchema>;

/** Compact document row for the thread's files panel — a slice of the full tax document. */
export const inboxDocumentSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  pipelineStatus: pipelineStatusSchema,
  createdAt: z.string().datetime(),
});
export type InboxDocument = z.infer<typeof inboxDocumentSchema>;

export const inboxThreadSchema = z.object({
  engagementId: z.string().min(1),
  clientName: z.string().min(1),
  taxYear: z.number().int(),
  filingType: filingTypeSchema,
  portalToken: z.string().min(1),
  /** True when any client message or inbound activity is unread. Outbound never counts. */
  unread: z.boolean(),
  /** Unread client messages + unread inbound (client/agent) events. */
  unreadCount: countSchema,
  /** Chronological, oldest first: messages interleaved with quiet system events. */
  timeline: z.array(inboxTimelineEntrySchema),
  /** The engagement's uploaded documents, newest first — the conversation's files panel. */
  documents: z.array(inboxDocumentSchema),
});
export type InboxThread = z.infer<typeof inboxThreadSchema>;

export const inboxThreadsResponseSchema = z.object({
  threads: z.array(inboxThreadSchema),
});

/** POST /api/inbox/threads/:engagementId/messages body — the CPA compose box. */
export const createInboxMessageInputSchema = messageSchema.pick({ body: true });
export type CreateInboxMessageInput = z.infer<typeof createInboxMessageInputSchema>;

export const inboxMessageResponseSchema = z.object({
  message: messageSchema,
});
