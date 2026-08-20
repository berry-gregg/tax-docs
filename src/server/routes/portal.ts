import { Hono } from "hono";
import { z } from "zod";
import { clientSchema } from "../../shared/schemas/client.ts";
import { taxDocumentSchema, type TaxDocument } from "../../shared/schemas/document.ts";
import { engagementSchema, filingTypeSchema } from "../../shared/schemas/engagement.ts";
import { requestItemSchema, type RequestItem } from "../../shared/schemas/request.ts";
import { connectDb } from "../db/client.ts";
import {
  clientsCollection,
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
} from "../db/collections.ts";
import type { PipelineRunner } from "../pipeline/runner.ts";
import { ingestUploadedFile } from "./documents.ts";

export const FIRM_NAME = "Tax Docs LLP";

const portalStatusSchema = z.enum(["waiting", "processing", "received", "needs-attention"]);

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

function portalStatusFor(item: RequestItem, documents: TaxDocument[]): z.infer<typeof portalStatusSchema> {
  const matched = documents.filter(
    (document) => item.matchedDocumentIds.includes(document.id) || document.requestItemId === item.id,
  );

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
  return { engagement, client, items, documents };
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
      items: loaded.items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        required: item.required,
        portalStatus: portalStatusFor(item, loaded.documents),
      })),
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

  return portalRoutes;
}
