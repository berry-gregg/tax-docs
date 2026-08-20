import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  createRecordInputSchema,
  recordSchema,
  type RecordItem,
} from "../../shared/schemas/record.ts";
import { connectDb } from "../db/client.ts";
import { recordsCollection } from "../db/collections.ts";

export const recordRoutes = new Hono();

recordRoutes.get("/", async (c) => {
  const db = await connectDb();
  const docs = await recordsCollection(db)
    .find({})
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  const records = docs.map((doc) =>
    recordSchema.parse({
      id: String(doc._id),
      title: doc.title,
      createdAt: doc.createdAt,
    }),
  );

  return c.json({ records });
});

recordRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createRecordInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const db = await connectDb();
  const createdAt = new Date().toISOString();
  const id = randomUUID();

  const record: RecordItem = {
    id,
    title: parsed.data.title,
    createdAt,
  };

  await recordsCollection(db).insertOne({
    _id: id,
    title: record.title,
    createdAt: record.createdAt,
  });

  return c.json({ record }, 201);
});
