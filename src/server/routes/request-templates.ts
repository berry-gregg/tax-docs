import { Hono } from "hono";
import { z } from "zod";
import { filingTypeSchema } from "../../shared/schemas/engagement.ts";
import {
  requestTemplateItemSchema,
  requestTemplateSchema,
  type RequestTemplate,
} from "../../shared/schemas/request.ts";
import { connectDb } from "../db/client.ts";
import { fromStored, requestTemplatesCollection, toStored } from "../db/collections.ts";

const updateRequestTemplateInputSchema = z.object({
  items: z.array(requestTemplateItemSchema).min(1),
});

export const requestTemplateRoutes = new Hono();

requestTemplateRoutes.get("/", async (c) => {
  const filingTypeParam = c.req.query("filingType");
  const parsedFilingType = filingTypeSchema.safeParse(filingTypeParam);

  const db = await connectDb();
  const filter = parsedFilingType.success ? { filingType: parsedFilingType.data } : {};
  const docs = await requestTemplatesCollection(db).find(filter).toArray();

  const templates = docs.map((doc) => fromStored(requestTemplateSchema, doc));

  return c.json({ templates });
});

requestTemplateRoutes.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateRequestTemplateInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const db = await connectDb();
  const existing = await requestTemplatesCollection(db).findOne({ _id: c.req.param("id") });

  if (!existing) {
    return c.json({ error: "Not found" }, 404);
  }

  const current = fromStored(requestTemplateSchema, existing);
  const updated: RequestTemplate = requestTemplateSchema.parse({
    ...current,
    items: parsed.data.items,
  });

  await requestTemplatesCollection(db).replaceOne({ _id: c.req.param("id") }, toStored(updated));

  return c.json({ template: updated });
});
