import { z } from "zod";
import { FIRM_NAME } from "../constants.ts";
import { activitySchema } from "./activity.ts";
import { clientSchema } from "./client.ts";
import { pipelineStatusSchema, taxDocumentSchema } from "./document.ts";
import { documentTypeSchema } from "./document-type.ts";
import { engagementSchema, filingTypeSchema } from "./engagement.ts";
import { messageSchema } from "./message.ts";
import { requestItemSchema, requestItemStatusSchema } from "./request.ts";

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

export const documentTypesResponseSchema = z.object({
  documentTypes: z.array(documentTypeSchema),
});

/** Reviewer override of the pipeline's classification — the target must be an active type. */
export const reclassifyDocumentInputSchema = z.object({
  // zodIssueSummary carries only issue messages, so the message itself must name the field.
  documentTypeId: z
    .string({ required_error: "documentTypeId is required" })
    .min(1, "documentTypeId is required"),
});
export type ReclassifyDocumentInput = z.infer<typeof reclassifyDocumentInputSchema>;

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

/**
 * A client-safe projection of a TaxDocument: filename, pipeline stage, resolved type name, and
 * upload time only. Confidence, reasoning, rejection detail, and extraction never cross this wire.
 */
export const portalDocumentSchema = z.object({
  id: z.string().min(1),
  filename: z.string().min(1),
  pipelineStatus: pipelineStatusSchema,
  documentTypeName: z.string().min(1).nullable(),
  uploadedAt: z.string().datetime(),
});
export type PortalDocument = z.infer<typeof portalDocumentSchema>;

export const portalItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean(),
  portalStatus: portalStatusSchema,
  /** Raw request-item status so the portal can render waived items honestly. */
  status: requestItemStatusSchema,
  waiveNote: z.string().max(500).optional(),
  /** The item's matched documents, resolved so they can nest under the checklist row. */
  documents: z.array(portalDocumentSchema),
});
export type PortalItem = z.infer<typeof portalItemSchema>;

export const portalStateSchema = z.object({
  firmName: z.literal(FIRM_NAME),
  clientName: z.string().min(1),
  taxYear: z.number().int(),
  filingType: filingTypeSchema,
  items: z.array(portalItemSchema),
  /** Client portal uploads not (yet) matched to any item — in-flight, unclassified, or rejected. */
  unmatched: z.array(portalDocumentSchema),
  /** Full CPA↔client thread, oldest first. Serving this state marks the firm's messages read. */
  messages: z.array(messageSchema),
});
export type PortalState = z.infer<typeof portalStateSchema>;

export const portalWaiveInputSchema = z.object({
  note: z.string().max(500).optional(),
});
export type PortalWaiveInput = z.infer<typeof portalWaiveInputSchema>;

export const portalMessageInputSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type PortalMessageInput = z.infer<typeof portalMessageInputSchema>;

export const portalMessageResponseSchema = z.object({
  message: messageSchema,
});

export const portalWaiveResponseSchema = z.object({
  item: portalItemSchema,
});
