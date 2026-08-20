import { Hono } from "hono";
import { activitySchema } from "../../shared/schemas/activity.ts";
import { clientSchema } from "../../shared/schemas/client.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import {
  inboxEntrySchema,
  inboxUnreadCountSchema,
  type InboxEntry,
} from "../../shared/schemas/inbox.ts";
import { connectDb } from "../db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  fromStored,
  toStored,
} from "../db/collections.ts";

export const inboxRoutes = new Hono();

inboxRoutes.get("/unread-count", async (c) => {
  const db = await connectDb();
  const count = await activitiesCollection(db).countDocuments({
    direction: "inbound",
    $nor: [{ readAt: { $type: "string" } }],
  });

  return c.json(inboxUnreadCountSchema.parse({ count }));
});

inboxRoutes.get("/", async (c) => {
  const db = await connectDb();
  const activityDocs = await activitiesCollection(db)
    .find({ direction: { $ne: "internal" } })
    .sort({ createdAt: -1 })
    .toArray();

  const activities = activityDocs.map((doc) => fromStored(activitySchema, doc));
  const engagementIds = [...new Set(activities.map((item) => item.engagementId))];
  const engagementDocs =
    engagementIds.length === 0
      ? []
      : await engagementsCollection(db)
          .find({ _id: { $in: engagementIds } })
          .toArray();
  const engagements = new Map(
    engagementDocs.map((doc) => {
      const engagement = fromStored(engagementSchema, doc);
      return [engagement.id, engagement] as const;
    }),
  );
  const clientIds = [...new Set([...engagements.values()].map((engagement) => engagement.clientId))];
  const clientDocs =
    clientIds.length === 0
      ? []
      : await clientsCollection(db)
          .find({ _id: { $in: clientIds } })
          .toArray();
  const clients = new Map(
    clientDocs.map((doc) => {
      const client = fromStored(clientSchema, doc);
      return [client.id, client] as const;
    }),
  );

  const entries: InboxEntry[] = activities.map((item) => {
    const engagement = engagements.get(item.engagementId);
    const client = engagement ? clients.get(engagement.clientId) : undefined;

    return inboxEntrySchema.parse({
      ...item,
      clientName: client?.legalName ?? "Unknown client",
      portalToken: engagement?.portalToken,
      unread: item.readAt === undefined && item.direction === "inbound",
    });
  });

  return c.json({ entries });
});

inboxRoutes.post("/:id/read", async (c) => {
  const db = await connectDb();
  const id = c.req.param("id");
  const existingDoc = await activitiesCollection(db).findOne({ _id: id });

  if (!existingDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const existing = fromStored(activitySchema, existingDoc);
  const activity = activitySchema.parse({
    ...existing,
    readAt: existing.readAt ?? new Date().toISOString(),
  });

  await activitiesCollection(db).replaceOne({ _id: id }, toStored(activity));

  return c.body(null, 204);
});
