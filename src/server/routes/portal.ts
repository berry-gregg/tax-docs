import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { FIRM_NAME } from "../../shared/constants.ts";
import {
  portalStateSchema,
  portalWaiveInputSchema,
  portalWaiveResponseSchema,
  type PortalDocument,
  type PortalItem,
  type PortalStatus,
} from "../../shared/schemas/api.ts";
import { activitySchema } from "../../shared/schemas/activity.ts";
import { clientSchema } from "../../shared/schemas/client.ts";
import { taxDocumentSchema, type TaxDocument } from "../../shared/schemas/document.ts";
import { documentTypeSchema } from "../../shared/schemas/document-type.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import { requestItemSchema, type RequestItem } from "../../shared/schemas/request.ts";
import { zodIssueSummary } from "../../shared/zod-issue-summary.ts";
import { connectDb } from "../db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  documentTypesCollection,
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../db/collections.ts";
import { readStoredFile } from "../files/storage.ts";
import type { PipelineRunner } from "../pipeline/runner.ts";
import { ingestUploadedFile } from "./documents.ts";

const PROCESSING_STATUSES = new Set<TaxDocument["pipelineStatus"]>([
  "received",
  "quality-review",
  "classifying",
  "extracting",
]);
const RECEIVED_STATUSES = new Set<TaxDocument["pipelineStatus"]>([
  "needs-review",
  "trusted",
  "unclassified",
]);

function matchedDocumentsFor(item: RequestItem, documents: TaxDocument[]): TaxDocument[] {
  return documents.filter(
    (document) => item.matchedDocumentIds.includes(document.id) || document.requestItemId === item.id,
  );
}

function portalStatusFor(item: RequestItem, matched: TaxDocument[]): PortalStatus {
  if (item.status === "needs-attention" || matched.some((document) => document.pipelineStatus === "rejected")) {
    return "needs-attention";
  }
  if (matched.some((document) => PROCESSING_STATUSES.has(document.pipelineStatus))) {
    return "processing";
  }
  if (matched.some((document) => RECEIVED_STATUSES.has(document.pipelineStatus)) || item.status === "received") {
    return "received";
  }
  return "waiting";
}

/** Client-safe projection: no confidence, no reasoning, no rejection detail, no extraction. */
function toPortalDocument(document: TaxDocument, typeNameById: Map<string, string>): PortalDocument {
  const documentTypeId = document.classification?.documentTypeId ?? null;
  return {
    id: document.id,
    filename: document.filename,
    pipelineStatus: document.pipelineStatus,
    documentTypeName: documentTypeId ? typeNameById.get(documentTypeId) ?? null : null,
    uploadedAt: document.createdAt,
  };
}

function toPortalItem(
  item: RequestItem,
  documents: TaxDocument[],
  typeNameById: Map<string, string>,
): PortalItem {
  const matched = matchedDocumentsFor(item, documents).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    required: item.required,
    portalStatus: portalStatusFor(item, matched),
    status: item.status,
    ...(item.waiveNote !== undefined ? { waiveNote: item.waiveNote } : {}),
    documents: matched.map((document) => toPortalDocument(document, typeNameById)),
  };
}

/** Portal uploads still working their way through the pipeline, or stalled without a match. */
function unmatchedDocuments(items: RequestItem[], documents: TaxDocument[]): TaxDocument[] {
  const matchedIds = new Set(
    items.flatMap((item) => matchedDocumentsFor(item, documents).map((document) => document.id)),
  );
  return documents
    .filter((document) => document.uploadedBy === "client" && !matchedIds.has(document.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function loadPortalEngagement(token: string) {
  const db = await connectDb();
  const engagementDoc = await engagementsCollection(db).findOne({ portalToken: token });
  if (!engagementDoc) {
    return null;
  }
  const engagement = fromStored(engagementSchema, engagementDoc);
  const clientDoc = await clientsCollection(db).findOne({ _id: engagement.clientId });
  if (!clientDoc) {
    return null;
  }
  const client = fromStored(clientSchema, clientDoc);
  const [itemDocs, documentDocs] = await Promise.all([
    requestItemsCollection(db).find({ engagementId: engagement.id }).sort({ title: 1 }).toArray(),
    taxDocumentsCollection(db).find({ engagementId: engagement.id }).toArray(),
  ]);
  const items = itemDocs.map((doc) => fromStored(requestItemSchema, doc));
  const documents = documentDocs.map((doc) => fromStored(taxDocumentSchema, doc));

  const typeIds = [
    ...new Set(
      documents
        .map((document) => document.classification?.documentTypeId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const typeDocs = typeIds.length > 0
    ? await documentTypesCollection(db).find({ _id: { $in: typeIds } }).toArray()
    : [];
  const typeNameById = new Map(
    typeDocs.map((doc) => {
      const documentType = fromStored(documentTypeSchema, doc);
      return [documentType.id, documentType.name] as const;
    }),
  );

  return { engagement, client, items, documents, typeNameById };
}

export function createPortalRoutes(runner: PipelineRunner) {
  const portalRoutes = new Hono();

  portalRoutes.get("/:token", async (c) => {
    const loaded = await loadPortalEngagement(c.req.param("token"));
    if (!loaded) {
      return c.json({ error: "Not found" }, 404);
    }

    const payload = portalStateSchema.parse({
      firmName: FIRM_NAME,
      clientName: loaded.client.legalName,
      taxYear: loaded.engagement.taxYear,
      filingType: loaded.engagement.filingType,
      items: loaded.items.map((item) => toPortalItem(item, loaded.documents, loaded.typeNameById)),
      unmatched: unmatchedDocuments(loaded.items, loaded.documents).map((document) =>
        toPortalDocument(document, loaded.typeNameById),
      ),
    });
    return c.json(payload);
  });

  portalRoutes.post("/:token/upload", async (c) => {
    const loaded = await loadPortalEngagement(c.req.param("token"));
    if (!loaded) {
      return c.json({ error: "Not found" }, 404);
    }

    const form = await c.req.formData();
    const requestItemIdValue = form.get("requestItemId");
    const result = await ingestUploadedFile({
      runner,
      file: form.get("file"),
      engagementId: loaded.engagement.id,
      requestItemId:
        typeof requestItemIdValue === "string" && requestItemIdValue.length > 0
          ? requestItemIdValue
          : undefined,
      uploadedBy: "client",
      actor: "client",
      direction: "inbound",
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json({ document: result.document }, 201);
  });

  portalRoutes.post("/:token/items/:itemId/waive", async (c) => {
    const loaded = await loadPortalEngagement(c.req.param("token"));
    if (!loaded) {
      return c.json({ error: "Not found" }, 404);
    }

    const item = loaded.items.find((candidate) => candidate.id === c.req.param("itemId"));
    if (!item) {
      return c.json({ error: "Not found" }, 404);
    }

    const parsed = portalWaiveInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: zodIssueSummary(parsed.error) }, 400);
    }
    if (item.status !== "open") {
      return c.json({ error: `Item is not open — current status is "${item.status}"` }, 409);
    }

    const note = parsed.data.note?.trim() || undefined;
    const waived = requestItemSchema.parse({
      ...item,
      status: "waived",
      ...(note !== undefined ? { waiveNote: note } : {}),
    });
    const now = new Date().toISOString();
    const activity = activitySchema.parse({
      id: randomUUID(),
      engagementId: loaded.engagement.id,
      actor: "client",
      action: "request-item-waived",
      detail: note !== undefined ? `${item.title} — ${note}` : item.title,
      direction: "inbound",
      requestItemId: item.id,
      createdAt: now,
    });

    const db = await connectDb();
    // Scoped to open so a racing pipeline match cannot be silently overwritten.
    const updated = await requestItemsCollection(db).updateOne(
      { _id: item.id, engagementId: loaded.engagement.id, status: "open" },
      { $set: { status: waived.status, ...(note !== undefined ? { waiveNote: note } : {}) } },
    );
    if (updated.matchedCount === 0) {
      return c.json({ error: "Item is no longer open" }, 409);
    }
    await activitiesCollection(db).insertOne(toStored(activity));

    return c.json(
      portalWaiveResponseSchema.parse({
        item: toPortalItem(waived, loaded.documents, loaded.typeNameById),
      }),
    );
  });

  /** Token-scoped PDF passthrough so the client can view their own uploads — 404 outside it. */
  portalRoutes.get("/:token/documents/:documentId/file", async (c) => {
    const loaded = await loadPortalEngagement(c.req.param("token"));
    if (!loaded) {
      return c.json({ error: "Not found" }, 404);
    }

    const document = loaded.documents.find(
      (candidate) => candidate.id === c.req.param("documentId"),
    );
    if (!document) {
      return c.json({ error: "Not found" }, 404);
    }

    try {
      const bytes = await readStoredFile(document.storagePath);
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      return c.body(body, 200, { "Content-Type": "application/pdf" });
    } catch (error) {
      const cause = error instanceof Error ? error.message : "stored file is missing";
      console.error(`Failed to read stored PDF for document ${document.id}: ${cause}`);
      return c.json({ error: "Not found" }, 404);
    }
  });

  return portalRoutes;
}
