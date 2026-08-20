import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { CLASSIFY_CONFIDENCE_THRESHOLD } from "../../shared/constants.ts";
import { activitySchema, type Activity } from "../../shared/schemas/activity.ts";
import { taxDocumentSchema, type TaxDocument } from "../../shared/schemas/document.ts";
import { documentTypeSchema, type DocumentType } from "../../shared/schemas/document-type.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import { requestItemSchema, type RequestItem } from "../../shared/schemas/request.ts";
import type { OpenRouterClient } from "../ai/openrouter.ts";
import { connectDb } from "../db/client.ts";
import {
  activitiesCollection,
  documentTypesCollection,
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../db/collections.ts";
import { readStoredFile } from "../files/storage.ts";
import { finalizeFields } from "./postprocess.ts";
import {
  runClassifyStage,
  runExtractStage,
  runQualityStage,
  type ClassifyResult,
  type QualityResult,
} from "./stages.ts";

export type PipelineDeps = { ai: OpenRouterClient };

type StageDocument = { filename: string; bytes: Uint8Array };

const UNSTATED_REJECTION_REASON = "The quality stage rejected the document without stating a reason";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadDocument(db: Db, documentId: string): Promise<TaxDocument | null> {
  const stored = await taxDocumentsCollection(db).findOne({ _id: documentId });
  return stored ? fromStored(taxDocumentSchema, stored) : null;
}

/** Every state transition round-trips the whole document through the schema before it persists. */
async function patchDocument(
  db: Db,
  document: TaxDocument,
  patch: Partial<TaxDocument>,
): Promise<TaxDocument> {
  const next = taxDocumentSchema.parse({
    ...document,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  await taxDocumentsCollection(db).replaceOne({ _id: next.id }, toStored(next));
  return next;
}

async function writeActivity(
  db: Db,
  entry: Pick<
    Activity,
    "engagementId" | "action" | "detail" | "direction" | "documentId" | "requestItemId"
  > &
    Partial<Pick<Activity, "actor">>,
): Promise<void> {
  const activity = activitySchema.parse({
    id: randomUUID(),
    actor: "agent",
    createdAt: new Date().toISOString(),
    ...entry,
  });
  await activitiesCollection(db).insertOne(toStored(activity));
}

async function activeDocumentTypes(db: Db): Promise<DocumentType[]> {
  const docs = await documentTypesCollection(db).find({ active: true }).toArray();
  return docs.map((doc) => fromStored(documentTypeSchema, doc));
}

async function setRequestItemStatus(
  db: Db,
  itemId: string,
  status: RequestItem["status"],
  documentId?: string,
): Promise<RequestItem | null> {
  const stored = await requestItemsCollection(db).findOne({ _id: itemId });
  if (!stored) return null;

  const existing = fromStored(requestItemSchema, stored);
  const matchedDocumentIds =
    documentId && !existing.matchedDocumentIds.includes(documentId)
      ? [...existing.matchedDocumentIds, documentId]
      : existing.matchedDocumentIds;
  const next = requestItemSchema.parse({ ...existing, status, matchedDocumentIds });
  await requestItemsCollection(db).replaceOne({ _id: itemId }, toStored(next));
  return next;
}

/**
 * The oldest open item of the type wins; with none open, an already-received item keeps
 * collecting further files of its type (an item can be satisfied by n documents). Waived and
 * needs-attention items never collect. `_id` breaks ties so a checklist created in one batch
 * still resolves to a stable item.
 */
async function findMatchableItem(
  db: Db,
  engagementId: string,
  documentTypeId: string,
): Promise<RequestItem | null> {
  for (const status of ["open", "received"] as const) {
    const stored = await requestItemsCollection(db).findOne(
      { engagementId, documentTypeId, status },
      { sort: { createdAt: 1, _id: 1 } },
    );
    if (stored) {
      return fromStored(requestItemSchema, stored);
    }
  }
  return null;
}

async function findRequestItem(
  db: Db,
  itemId: string,
  engagementId: string,
): Promise<RequestItem | null> {
  const stored = await requestItemsCollection(db).findOne({ _id: itemId, engagementId });
  return stored ? fromStored(requestItemSchema, stored) : null;
}

async function promoteEngagementToReview(db: Db, engagementId: string): Promise<void> {
  const stored = await engagementsCollection(db).findOne({ _id: engagementId });
  if (!stored) return;

  const engagement = fromStored(engagementSchema, stored);
  if (engagement.status !== "collecting") return;

  const next = engagementSchema.parse({
    ...engagement,
    status: "in-review",
    updatedAt: new Date().toISOString(),
  });
  await engagementsCollection(db).replaceOne({ _id: engagementId }, toStored(next));
}

async function rejectDocument(
  db: Db,
  document: TaxDocument,
  quality: QualityResult,
): Promise<void> {
  const reason = quality.reason.trim() || UNSTATED_REJECTION_REASON;
  const rejected = await patchDocument(db, document, {
    pipelineStatus: "rejected",
    rejection: { kind: quality.relevant ? "unreadable" : "irrelevant", reason },
  });

  if (rejected.requestItemId) {
    await setRequestItemStatus(db, rejected.requestItemId, "needs-attention");
  }

  await writeActivity(db, {
    engagementId: rejected.engagementId,
    action: "document-rejected",
    detail: `${rejected.filename} — ${reason}`,
    direction: "inbound",
    documentId: rejected.id,
  });
}

async function markUnclassified(
  db: Db,
  document: TaxDocument,
  classification: ClassifyResult,
): Promise<void> {
  const unclassified = await patchDocument(db, document, {
    classification,
    pipelineStatus: "unclassified",
  });
  await writeActivity(db, {
    engagementId: unclassified.engagementId,
    action: "document-unclassified",
    // The model's reasoning is untrusted prose and stays on the document, out of the feed.
    detail: `${unclassified.filename} — no confident document type match (confidence ${classification.confidence.toFixed(2)})`,
    direction: "inbound",
    documentId: unclassified.id,
  });
}

/**
 * Links the document to a checklist item — the one it was uploaded against, or the oldest open
 * (falling back to received) match. A document that was uploaded against the wrong item is left
 * for the CPA to reconcile: satisfying a "Form 941" request with a bank statement would report
 * the checklist complete.
 */
async function linkChecklistItem(
  db: Db,
  document: TaxDocument,
  documentTypeId: string,
): Promise<TaxDocument> {
  const candidate = document.requestItemId
    ? await findRequestItem(db, document.requestItemId, document.engagementId)
    : await findMatchableItem(db, document.engagementId, documentTypeId);
  if (!candidate || candidate.documentTypeId !== documentTypeId) return document;

  const item = await setRequestItemStatus(db, candidate.id, "received", document.id);
  if (!item) return document;

  const linked = document.requestItemId
    ? document
    : await patchDocument(db, document, { requestItemId: candidate.id });
  // Inbound and item-scoped: this is the client's request being fulfilled, so the inbox
  // thread rolls it up under the checklist line instead of hiding it as bookkeeping.
  await writeActivity(db, {
    engagementId: linked.engagementId,
    action: "checklist-item-matched",
    detail: `${item.title} — ${linked.filename}`,
    direction: "inbound",
    requestItemId: item.id,
  });
  return linked;
}

/**
 * Releases the document from a checklist item whose type no longer matches. The item keeps
 * collecting its other files; with none left, a received item reopens so the request reads as
 * honestly outstanding again. Waived and needs-attention statuses are CPA decisions and stay.
 */
async function unlinkChecklistItem(db: Db, document: TaxDocument): Promise<TaxDocument> {
  if (!document.requestItemId) return document;

  const stored = await requestItemsCollection(db).findOne({ _id: document.requestItemId });
  if (stored) {
    const item = fromStored(requestItemSchema, stored);
    const matchedDocumentIds = item.matchedDocumentIds.filter((id) => id !== document.id);
    const status =
      item.status === "received" && matchedDocumentIds.length === 0 ? "open" : item.status;
    const next = requestItemSchema.parse({ ...item, status, matchedDocumentIds });
    await requestItemsCollection(db).replaceOne({ _id: item.id }, toStored(next));
  }

  return patchDocument(db, document, { requestItemId: undefined });
}

async function extractDocument(
  db: Db,
  document: TaxDocument,
  stageDocument: StageDocument,
  documentType: DocumentType,
  deps: PipelineDeps,
): Promise<void> {
  const extracting = await patchDocument(db, document, { pipelineStatus: "extracting" });
  const raw = await runExtractStage(deps.ai, stageDocument, documentType);
  const fields = finalizeFields(raw, documentType);
  const reviewed = await patchDocument(db, extracting, {
    extraction: { fields },
    pipelineStatus: "needs-review",
  });

  const notFound = fields.filter((field) => field.notFound).length;
  await writeActivity(db, {
    engagementId: reviewed.engagementId,
    action: "document-extracted",
    detail: `${reviewed.filename} — ${fields.length} fields extracted, ${notFound} not found`,
    direction: "inbound",
    documentId: reviewed.id,
  });
  await promoteEngagementToReview(db, reviewed.engagementId);
}

async function runStages(db: Db, received: TaxDocument, deps: PipelineDeps): Promise<void> {
  const bytes = await readStoredFile(received.storagePath);
  const stageDocument: StageDocument = { filename: received.filename, bytes };

  const inQualityReview = await patchDocument(db, received, { pipelineStatus: "quality-review" });
  const quality = await runQualityStage(deps.ai, stageDocument);
  if (!quality.relevant || !quality.legible) {
    await rejectDocument(db, inQualityReview, quality);
    return;
  }

  const classifying = await patchDocument(db, inQualityReview, { pipelineStatus: "classifying" });
  const candidates = await activeDocumentTypes(db);
  const classification = await runClassifyStage(deps.ai, stageDocument, candidates);
  // An id the model invented is a miss, not a system fault — it belongs in the unclassified lane.
  const documentType = candidates.find((type) => type.id === classification.documentTypeId);
  if (!documentType || classification.confidence < CLASSIFY_CONFIDENCE_THRESHOLD) {
    await markUnclassified(db, classifying, classification);
    return;
  }

  const classified = await patchDocument(db, classifying, { classification });
  const linked = await linkChecklistItem(db, classified, documentType.id);
  await extractDocument(db, linked, stageDocument, documentType, deps);
}

/** Shared terminal lane: the failure lands on top of whatever the stages already persisted. */
async function recordPipelineFailure(
  db: Db,
  documentId: string,
  fallback: TaxDocument,
  error: unknown,
): Promise<void> {
  const message = messageOf(error);
  const latest = (await loadDocument(db, documentId)) ?? fallback;
  const failed = await patchDocument(db, latest, {
    pipelineStatus: "failed",
    failure: { message },
  });
  await writeActivity(db, {
    engagementId: failed.engagementId,
    action: "document-failed",
    detail: `${failed.filename} — ${message}`,
    direction: "internal",
  });
}

const RECLASSIFY_REASONING = "Reclassified by reviewer";

/**
 * Extract-only continuation for a reviewer's type override. The classification is written as a
 * human decision — confidence 1 with honest provenance, never a faked model rationale — and
 * classify never re-runs, so the model cannot second-guess the reviewer. Everything after the
 * document load shares the full pipeline's failure lane: a bad type or a throwing extract stage
 * lands in `failed` with its real cause instead of leaving the document stuck mid-flight.
 */
export async function reclassifyDocument(
  documentId: string,
  documentTypeId: string,
  deps: PipelineDeps,
): Promise<void> {
  const db = await connectDb();
  const document = await loadDocument(db, documentId);
  if (!document) {
    throw new Error(`Reclassify cannot run: document ${documentId} was not found`);
  }

  try {
    const stored = await documentTypesCollection(db).findOne({ _id: documentTypeId });
    const documentType = stored ? fromStored(documentTypeSchema, stored) : null;
    if (!documentType?.active) {
      throw new Error(`Reclassify cannot run: ${documentTypeId} is not an active document type`);
    }

    // A link to an item of another type is released before the new type gets to match.
    const currentItem = document.requestItemId
      ? await findRequestItem(db, document.requestItemId, document.engagementId)
      : null;
    const unlinked =
      currentItem && currentItem.documentTypeId !== documentType.id
        ? await unlinkChecklistItem(db, document)
        : document;

    const reclassified = await patchDocument(db, unlinked, {
      classification: {
        documentTypeId: documentType.id,
        confidence: 1,
        reasoning: RECLASSIFY_REASONING,
      },
      extraction: undefined,
      failure: undefined,
    });
    await writeActivity(db, {
      engagementId: reclassified.engagementId,
      actor: "cpa",
      action: "document-reclassified",
      detail: `${reclassified.filename} — reclassified as ${documentType.name}`,
      direction: "internal",
      documentId: reclassified.id,
    });

    const linked = await linkChecklistItem(db, reclassified, documentType.id);
    const bytes = await readStoredFile(linked.storagePath);
    await extractDocument(db, linked, { filename: linked.filename, bytes }, documentType, deps);
  } catch (error) {
    await recordPipelineFailure(db, documentId, document, error);
  }
}

export async function runPipeline(documentId: string, deps: PipelineDeps): Promise<void> {
  const db = await connectDb();
  const document = await loadDocument(db, documentId);
  if (!document) {
    throw new Error(`Pipeline cannot run: document ${documentId} was not found`);
  }

  try {
    await runStages(db, document, deps);
  } catch (error) {
    await recordPipelineFailure(db, documentId, document, error);
  }
}
