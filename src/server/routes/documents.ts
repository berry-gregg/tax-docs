import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "../../shared/constants.ts";
import { activitySchema, type Activity } from "../../shared/schemas/activity.ts";
import {
  documentListResponseSchema,
  documentListRowSchema,
} from "../../shared/schemas/api.ts";
import { clientSchema } from "../../shared/schemas/client.ts";
import {
  taxDocumentSchema,
  type ExtractionField,
  type TaxDocument,
} from "../../shared/schemas/document.ts";
import {
  createDocumentTypeInputSchema,
  documentTypeSchema,
} from "../../shared/schemas/document-type.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import { zodIssueSummary } from "../../shared/zod-issue-summary.ts";
import { defaultDataTypeFor } from "../../shared/schemas/metadata.ts";
import type { OpenRouterClient } from "../ai/openrouter.ts";
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
import { readStoredFile, saveUploadedFile } from "../files/storage.ts";
import type { PipelineRunner } from "../pipeline/runner.ts";
import { runDraftTypeStage } from "../pipeline/stages.ts";

const groupQuerySchema = z.enum(["needs-review", "approved", "all"]);

const fieldActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({
    action: z.literal("edit"),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
]);

type PipelineStatus = TaxDocument["pipelineStatus"];

const RERUN_STATUSES = new Set<PipelineStatus>(["failed", "unclassified", "rejected"]);

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export type IngestUploadResult =
  | { ok: true; document: TaxDocument }
  | { ok: false; status: 400 | 404; error: string };

export async function ingestUploadedFile(opts: {
  runner: PipelineRunner;
  file: unknown;
  engagementId: string;
  requestItemId?: string;
  uploadedBy: TaxDocument["uploadedBy"];
  actor: Activity["actor"];
  direction: Activity["direction"];
}): Promise<IngestUploadResult> {
  if (!(opts.file instanceof File)) {
    return { ok: false, status: 400, error: "PDF file is required" };
  }
  if (!isPdfFile(opts.file)) {
    return { ok: false, status: 400, error: "Upload must be a PDF" };
  }
  if (opts.file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 400, error: "File is too large" };
  }

  const bytes = new Uint8Array(await opts.file.arrayBuffer());
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 400, error: "File is too large" };
  }

  const db = await connectDb();
  const engagementDoc = await engagementsCollection(db).findOne({ _id: opts.engagementId });
  if (!engagementDoc) {
    return { ok: false, status: 404, error: "Not found" };
  }

  if (opts.requestItemId) {
    const itemDoc = await requestItemsCollection(db).findOne({
      _id: opts.requestItemId,
      engagementId: opts.engagementId,
    });
    if (!itemDoc) {
      return { ok: false, status: 404, error: "Not found" };
    }
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const storagePath = await saveUploadedFile(id, bytes);
  const document = taxDocumentSchema.parse({
    id,
    engagementId: opts.engagementId,
    requestItemId: opts.requestItemId,
    filename: opts.file.name,
    mimeType: "application/pdf",
    size: bytes.byteLength,
    storagePath,
    uploadedBy: opts.uploadedBy,
    pipelineStatus: "received",
    createdAt: now,
    updatedAt: now,
  });
  const activity = activitySchema.parse({
    id: randomUUID(),
    engagementId: opts.engagementId,
    actor: opts.actor,
    action: "document-uploaded",
    detail: document.filename,
    direction: opts.direction,
    documentId: document.id,
    createdAt: now,
  });

  await taxDocumentsCollection(db).insertOne(toStored(document));
  await activitiesCollection(db).insertOne(toStored(activity));
  if (opts.requestItemId) {
    await requestItemsCollection(db).updateOne(
      { _id: opts.requestItemId, engagementId: opts.engagementId },
      { $addToSet: { matchedDocumentIds: document.id } },
    );
  }

  opts.runner.start(document.id);
  return { ok: true, document };
}

async function findDocument(id: string): Promise<TaxDocument | null> {
  const db = await connectDb();
  const doc = await taxDocumentsCollection(db).findOne({ _id: id });
  if (!doc) {
    return null;
  }
  return fromStored(taxDocumentSchema, doc);
}

async function replaceDocument(document: TaxDocument): Promise<void> {
  const db = await connectDb();
  await taxDocumentsCollection(db).replaceOne({ _id: document.id }, toStored(document));
}

function groupFilter(group: z.infer<typeof groupQuerySchema>): { pipelineStatus?: { $in: PipelineStatus[] } | PipelineStatus } {
  if (group === "needs-review") {
    return { pipelineStatus: { $in: ["needs-review", "unclassified"] } };
  }
  if (group === "approved") {
    return { pipelineStatus: "trusted" };
  }
  return {};
}

async function toListRows(documents: TaxDocument[]) {
  const db = await connectDb();
  const engagementIds = [...new Set(documents.map((document) => document.engagementId))];
  const typeIds = [
    ...new Set(
      documents
        .map((document) => document.classification?.documentTypeId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const [engagementDocs, typeDocs] = await Promise.all([
    engagementIds.length > 0
      ? engagementsCollection(db).find({ _id: { $in: engagementIds } }).toArray()
      : Promise.resolve([]),
    typeIds.length > 0
      ? documentTypesCollection(db).find({ _id: { $in: typeIds } }).toArray()
      : Promise.resolve([]),
  ]);
  const engagements = engagementDocs.map((doc) => fromStored(engagementSchema, doc));
  const engagementById = new Map(engagements.map((engagement) => [engagement.id, engagement]));
  const clientIds = [...new Set(engagements.map((engagement) => engagement.clientId))];
  const clientDocs = clientIds.length > 0
    ? await clientsCollection(db).find({ _id: { $in: clientIds } }).toArray()
    : [];
  const clientById = new Map(
    clientDocs.map((doc) => {
      const client = fromStored(clientSchema, doc);
      return [client.id, client] as const;
    }),
  );
  const typeById = new Map(
    typeDocs.map((doc) => {
      const documentType = fromStored(documentTypeSchema, doc);
      return [documentType.id, documentType] as const;
    }),
  );

  return documents.map((document) => {
    const engagement = engagementById.get(document.engagementId);
    const client = engagement ? clientById.get(engagement.clientId) : undefined;
    const documentTypeId = document.classification?.documentTypeId ?? undefined;
    const documentType = documentTypeId ? typeById.get(documentTypeId) : undefined;
    return documentListRowSchema.parse({
      ...document,
      clientName: client?.legalName ?? "Unknown client",
      engagementLabel: engagement
        ? `${engagement.taxYear} ${engagement.filingType}`
        : "Unknown engagement",
      documentTypeName: documentType?.name,
    });
  });
}

export function createDocumentRoutes(runner: PipelineRunner, ai: OpenRouterClient) {
  const documentRoutes = new Hono();

  documentRoutes.get("/", async (c) => {
    const parsedGroup = groupQuerySchema.safeParse(c.req.query("group") ?? "all");
    if (!parsedGroup.success) {
      return c.json({ error: zodIssueSummary(parsedGroup.error) }, 400);
    }

    const db = await connectDb();
    const docs = await taxDocumentsCollection(db)
      .find(groupFilter(parsedGroup.data))
      .sort({ createdAt: -1 })
      .toArray();
    const documents = await toListRows(docs.map((doc) => fromStored(taxDocumentSchema, doc)));
    return c.json(documentListResponseSchema.parse({ documents }));
  });

  documentRoutes.post("/", async (c) => {
    const form = await c.req.formData();
    const engagementId = form.get("engagementId");
    const requestItemIdValue = form.get("requestItemId");
    if (typeof engagementId !== "string" || engagementId.length === 0) {
      return c.json({ error: "engagementId is required" }, 400);
    }

    const result = await ingestUploadedFile({
      runner,
      file: form.get("file"),
      engagementId,
      requestItemId:
        typeof requestItemIdValue === "string" && requestItemIdValue.length > 0
          ? requestItemIdValue
          : undefined,
      uploadedBy: "cpa",
      actor: "cpa",
      direction: "internal",
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json({ document: result.document }, 201);
  });

  documentRoutes.get("/:id/file", async (c) => {
    const document = await findDocument(c.req.param("id"));
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
      return c.json({ error: cause }, 404);
    }
  });

  documentRoutes.get("/:id", async (c) => {
    const document = await findDocument(c.req.param("id"));
    if (!document) {
      return c.json({ error: "Not found" }, 404);
    }

    const documentTypeId = document.classification?.documentTypeId;
    if (!documentTypeId) {
      return c.json({ document });
    }

    const db = await connectDb();
    const typeDoc = await documentTypesCollection(db).findOne({ _id: documentTypeId });
    const documentType = typeDoc ? fromStored(documentTypeSchema, typeDoc) : undefined;
    return c.json({ document, documentType });
  });

  documentRoutes.patch("/:id/fields/:key", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = fieldActionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: zodIssueSummary(parsed.error) }, 400);
    }

    const document = await findDocument(c.req.param("id"));
    if (!document) {
      return c.json({ error: "Not found" }, 404);
    }
    if (document.pipelineStatus !== "needs-review") {
      return c.json({ error: "Document is not awaiting review" }, 409);
    }

    const key = c.req.param("key");
    const fields = document.extraction?.fields ?? [];
    const index = fields.findIndex((field) => field.key === key);
    if (index === -1) {
      return c.json({ error: "Not found" }, 404);
    }

    const current = fields[index];
    const updatedField: ExtractionField =
      parsed.data.action === "accept"
        ? { ...current, reviewStatus: "accepted" }
        : { ...current, reviewStatus: "edited", editedValue: parsed.data.value };
    const nextFields = fields.slice();
    nextFields[index] = updatedField;
    const updated = taxDocumentSchema.parse({
      ...document,
      extraction: { fields: nextFields },
      updatedAt: new Date().toISOString(),
    });
    await replaceDocument(updated);
    return c.json({ document: updated });
  });

  documentRoutes.post("/:id/trust", async (c) => {
    const document = await findDocument(c.req.param("id"));
    if (!document) {
      return c.json({ error: "Not found" }, 404);
    }
    if (document.pipelineStatus !== "needs-review") {
      return c.json({ error: "Document is not awaiting review" }, 409);
    }

    const fields = document.extraction?.fields ?? [];
    if (fields.length === 0) {
      return c.json({ error: "extraction returned no fields" }, 409);
    }
    if (fields.some((field) => field.reviewStatus === "unreviewed")) {
      return c.json({ error: "unreviewed fields remain" }, 409);
    }

    const now = new Date().toISOString();
    const updated = taxDocumentSchema.parse({
      ...document,
      pipelineStatus: "trusted",
      updatedAt: now,
    });
    const activity = activitySchema.parse({
      id: randomUUID(),
      engagementId: document.engagementId,
      actor: "cpa",
      action: "document-trusted",
      detail: document.filename,
      direction: "internal",
      createdAt: now,
    });

    const db = await connectDb();
    await taxDocumentsCollection(db).replaceOne({ _id: document.id }, toStored(updated));
    await activitiesCollection(db).insertOne(toStored(activity));
    return c.json({ document: updated });
  });

  documentRoutes.post("/:id/rerun", async (c) => {
    const document = await findDocument(c.req.param("id"));
    if (!document) {
      return c.json({ error: "Not found" }, 404);
    }
    if (!RERUN_STATUSES.has(document.pipelineStatus)) {
      return c.json({ error: "Document cannot be rerun from its current status" }, 409);
    }

    const { rejection: _rejection, failure: _failure, ...rest } = document;
    const updated = taxDocumentSchema.parse({
      ...rest,
      pipelineStatus: "received",
      updatedAt: new Date().toISOString(),
    });
    await replaceDocument(updated);
    runner.start(updated.id);
    return c.json({ document: updated });
  });

  /**
   * Fail-soft escape hatch for the unclassified lane: the model proposes a schema, the server
   * decides the mechanical parts, and nothing is persisted. The CPA edits the draft, POSTs it to
   * `/api/document-types`, then reruns the document against the type they just created.
   */
  documentRoutes.post("/:id/draft-type", async (c) => {
    const document = await findDocument(c.req.param("id"));
    if (!document) {
      return c.json({ error: "Not found" }, 404);
    }
    if (document.pipelineStatus !== "unclassified") {
      return c.json({ error: "Document is not unclassified" }, 409);
    }

    try {
      const bytes = await readStoredFile(document.storagePath);
      const result = await runDraftTypeStage(ai, { filename: document.filename, bytes });
      const draft = createDocumentTypeInputSchema.parse({
        name: result.name,
        description: result.description,
        active: true,
        // The model proposes structure only: the server owns dataType, and a drafted field is
        // never required and never carries a regex until a person says so.
        fields: result.fields.map((field) => ({
          ...field,
          dataType: defaultDataTypeFor(field.metadataType),
          required: false,
        })),
      });
      return c.json({ draft });
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      console.error(`Draft document type for document ${document.id} failed: ${cause}`);
      return c.json({ error: cause }, 502);
    }
  });

  return documentRoutes;
}
