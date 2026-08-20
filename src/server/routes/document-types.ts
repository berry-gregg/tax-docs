import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  createDocumentTypeInputSchema,
  documentTypeSchema,
  updateDocumentTypeInputSchema,
  type DocumentType,
} from "../../shared/schemas/document-type.ts";
import { zodIssueSummary } from "../../shared/zod-issue-summary.ts";
import { connectDb } from "../db/client.ts";
import { documentTypesCollection, fromStored, toStored } from "../db/collections.ts";

export const documentTypeRoutes = new Hono();

documentTypeRoutes.get("/", async (c) => {
  const db = await connectDb();
  const docs = await documentTypesCollection(db)
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  const documentTypes = docs.map((doc) => fromStored(documentTypeSchema, doc));

  return c.json({ documentTypes });
});

documentTypeRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createDocumentTypeInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  const documentType: DocumentType = documentTypeSchema.parse({
    id,
    name: parsed.data.name,
    description: parsed.data.description,
    active: parsed.data.active,
    createdBy: "cpa",
    fields: parsed.data.fields,
    createdAt,
  });

  await documentTypesCollection(db).insertOne(toStored(documentType));

  return c.json({ documentType }, 201);
});

documentTypeRoutes.get("/:id", async (c) => {
  const db = await connectDb();
  const doc = await documentTypesCollection(db).findOne({ _id: c.req.param("id") });

  if (!doc) {
    return c.json({ error: "Not found" }, 404);
  }

  const documentType = fromStored(documentTypeSchema, doc);
  return c.json({ documentType });
});

documentTypeRoutes.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateDocumentTypeInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const existing = await documentTypesCollection(db).findOne({ _id: c.req.param("id") });

  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  const current = fromStored(documentTypeSchema, existing);
  const updated: DocumentType = documentTypeSchema.parse({
    ...current,
    ...parsed.data,
  });

  await documentTypesCollection(db).replaceOne({ _id: c.req.param("id") }, toStored(updated));

  return c.json({ documentType: updated });
});
