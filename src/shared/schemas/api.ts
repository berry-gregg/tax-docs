import { z } from "zod";
import { FIRM_NAME } from "../constants.ts";
import { activitySchema } from "./activity.ts";
import { clientSchema } from "./client.ts";
import { taxDocumentSchema } from "./document.ts";
import { engagementSchema, filingTypeSchema } from "./engagement.ts";
import { requestItemSchema } from "./request.ts";

/**
 * Wire shapes for `/api/*`. Server routes build their payloads through these schemas and the
 * client parses the same objects back out, so a row gains a field in exactly one place.
 */

const countSchema = z.number().int().nonnegative();

export const engagementListRowSchema = engagementSchema.extend({
  clientName: z.string().min(1),
  docCounts: z.object({
    total: countSchema,
    needsReview: countSchema,
  }),
  openItems: countSchema,
});
export type EngagementListRow = z.infer<typeof engagementListRowSchema>;

export const engagementListResponseSchema = z.object({
  engagements: z.array(engagementListRowSchema),
});

export const engagementDetailSchema = z.object({
  engagement: engagementSchema,
  client: clientSchema,
  requestItems: z.array(requestItemSchema),
  documents: z.array(taxDocumentSchema),
  activity: z.array(activitySchema),
});
export type EngagementDetail = z.infer<typeof engagementDetailSchema>;

export const documentListRowSchema = taxDocumentSchema.extend({
  clientName: z.string().min(1),
  engagementLabel: z.string().min(1),
  documentTypeName: z.string().min(1).optional(),
});
export type DocumentListRow = z.infer<typeof documentListRowSchema>;

export const documentListResponseSchema = z.object({
  documents: z.array(documentListRowSchema),
});

export const clientListResponseSchema = z.object({
  clients: z.array(clientSchema),
});

export const inboxEntrySchema = activitySchema.extend({
  clientName: z.string().min(1),
  portalToken: z.string().min(1).optional(),
  unread: z.boolean(),
});
export type InboxEntry = z.infer<typeof inboxEntrySchema>;

export const inboxListResponseSchema = z.object({
  entries: z.array(inboxEntrySchema),
});

export const inboxUnreadCountSchema = z.object({
  count: countSchema,
});
export type InboxUnreadCount = z.infer<typeof inboxUnreadCountSchema>;

/**
 * Home metrics. `documentsAutoProcessed` is trusted-only — straight-through
 * without sitting in the human queue. `straightThroughRate` is
 * round(100 × trusted / terminal-ish), 0 when the denominator is empty.
 * Terminal-ish statuses: needs-review, trusted, rejected, unclassified, failed.
 */
export const metricsSchema = z.object({
  documentsAutoProcessed: countSchema,
  fieldsAwaitingReview: countSchema,
  straightThroughRate: countSchema,
  needsReviewCount: countSchema,
  outstandingRequests: countSchema,
  activeClients: countSchema,
});
export type Metrics = z.infer<typeof metricsSchema>;

/**
 * Deliberately coarse: the client never learns why a document needs attention, only that it does.
 */
export const portalStatusSchema = z.enum(["waiting", "processing", "received", "needs-attention"]);
export type PortalStatus = z.infer<typeof portalStatusSchema>;

export const portalStateSchema = z.object({
  firmName: z.literal(FIRM_NAME),
  clientName: z.string().min(1),
  taxYear: z.number().int(),
  filingType: filingTypeSchema,
  items: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      required: z.boolean(),
      portalStatus: portalStatusSchema,
    }),
  ),
});
export type PortalState = z.infer<typeof portalStateSchema>;
