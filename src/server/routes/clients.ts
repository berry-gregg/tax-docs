import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  clientSchema,
  createClientInputSchema,
  type Client,
} from "../../shared/schemas/client.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import { zodIssueSummary } from "../../shared/zod-issue-summary.ts";
import { connectDb } from "../db/client.ts";
import {
  clientsCollection,
  engagementsCollection,
  fromStored,
  toStored,
} from "../db/collections.ts";

export const clientRoutes = new Hono();

const updateClientInputSchema = createClientInputSchema.partial();

clientRoutes.get("/", async (c) => {
  const db = await connectDb();
  const docs = await clientsCollection(db).find({}).sort({ legalName: 1 }).toArray();
  const clients = docs.map((doc) => fromStored(clientSchema, doc));

  return c.json({ clients });
});

clientRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createClientInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const client: Client = clientSchema.parse({
    id: randomUUID(),
    ...parsed.data,
    createdAt: new Date().toISOString(),
  });

  await clientsCollection(db).insertOne(toStored(client));

  return c.json({ client }, 201);
});

clientRoutes.get("/:id", async (c) => {
  const db = await connectDb();
  const id = c.req.param("id");
  const doc = await clientsCollection(db).findOne({ _id: id });

  if (!doc) {
    return c.json({ error: "Not found" }, 404);
  }

  const client = fromStored(clientSchema, doc);
  const engagementDocs = await engagementsCollection(db)
    .find({ clientId: id })
    .sort({ createdAt: -1 })
    .toArray();
  const engagements = engagementDocs.map((engagementDoc) =>
    fromStored(engagementSchema, engagementDoc),
  );

  return c.json({ client, engagements });
});

clientRoutes.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateClientInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const id = c.req.param("id");
  const existingDoc = await clientsCollection(db).findOne({ _id: id });

  if (!existingDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const existing = fromStored(clientSchema, existingDoc);
  const client = clientSchema.parse({
    ...existing,
    ...parsed.data,
  });

  await clientsCollection(db).replaceOne({ _id: id }, toStored(client));

  return c.json({ client });
});
