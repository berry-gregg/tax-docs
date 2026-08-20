import { Hono } from "hono";
import { activitySchema, type Activity } from "../../shared/schemas/activity.ts";
import { inboxUnreadCountSchema } from "../../shared/schemas/api.ts";
import { clientSchema } from "../../shared/schemas/client.ts";
import { taxDocumentSchema } from "../../shared/schemas/document.ts";
import { engagementSchema, type Engagement } from "../../shared/schemas/engagement.ts";
import {
  inboxThreadSchema,
  inboxThreadsResponseSchema,
  type InboxThread,
  type InboxThreadItem,
} from "../../shared/schemas/inbox.ts";
import { requestItemSchema, type RequestItem } from "../../shared/schemas/request.ts";
import { connectDb } from "../db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
  toStored,
} from "../db/collections.ts";
import type { z } from "zod";

export const inboxRoutes = new Hono();

/** Internal activities are pipeline bookkeeping; only the visible ones drive threads and unread. */
const visibleFilter = { direction: { $ne: "internal" as const } };
/** `$nor $type` (not `$exists`) so a stored `readAt: null` still counts as unread. */
const unreadFilter = { ...visibleFilter, $nor: [{ readAt: { $type: "string" as const } }] };

function isUnread(activity: Activity): boolean {
  return activity.readAt === undefined;
}

/** The slice of a document a thread needs: identity, item linkage, filename, and recency. */
const threadDocumentSchema = taxDocumentSchema.pick({
  id: true,
  engagementId: true,
  requestItemId: true,
  filename: true,
  createdAt: true,
  updatedAt: true,
});
type ThreadDocument = z.infer<typeof threadDocumentSchema>;

function toThreadItem(
  item: RequestItem,
  activities: Activity[],
  documents: ThreadDocument[],
): InboxThreadItem {
  const linkedDocuments = documents
    .filter(
      (doc) => doc.requestItemId === item.id || item.matchedDocumentIds.includes(doc.id),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const latestDocument = linkedDocuments[linkedDocuments.length - 1];
  const linksDocument =
    latestDocument !== undefined &&
    (item.status === "received" || item.status === "needs-attention");

  const timestamps = [
    item.createdAt,
    ...activities.filter((entry) => entry.requestItemId === item.id).map((entry) => entry.createdAt),
    ...(latestDocument ? [latestDocument.updatedAt] : []),
  ];
  const lastUpdateAt = timestamps.reduce((max, value) => (value > max ? value : max));

  return {
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.waiveNote !== undefined ? { waiveNote: item.waiveNote } : {}),
    ...(linksDocument
      ? { documentId: latestDocument.id, documentFilename: latestDocument.filename }
      : {}),
    lastUpdateAt,
  };
}

inboxRoutes.get("/unread-count", async (c) => {
  const db = await connectDb();
  const engagementIds = await activitiesCollection(db).distinct("engagementId", unreadFilter);

  return c.json(inboxUnreadCountSchema.parse({ count: engagementIds.length }));
});

inboxRoutes.get("/", async (c) => {
  const db = await connectDb();
  const activityDocs = await activitiesCollection(db)
    .find(visibleFilter)
    .sort({ createdAt: -1 })
    .toArray();
  const activities = activityDocs.map((doc) => fromStored(activitySchema, doc));

  // Newest visible activity first — Map insertion order is the thread order.
  const byEngagement = new Map<string, Activity[]>();
  for (const activity of activities) {
    const group = byEngagement.get(activity.engagementId);
    if (group) {
      group.push(activity);
    } else {
      byEngagement.set(activity.engagementId, [activity]);
    }
  }

  const engagementIds = [...byEngagement.keys()];
  const [engagementDocs, requestItemDocs, documentDocs] =
    engagementIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          engagementsCollection(db)
            .find({ _id: { $in: engagementIds } })
            .toArray(),
          requestItemsCollection(db)
            .find({ engagementId: { $in: engagementIds } })
            .sort({ createdAt: 1, _id: 1 })
            .toArray(),
          taxDocumentsCollection(db)
            .find(
              { engagementId: { $in: engagementIds } },
              {
                projection: {
                  _id: 1,
                  engagementId: 1,
                  requestItemId: 1,
                  filename: 1,
                  createdAt: 1,
                  updatedAt: 1,
                },
              },
            )
            .toArray(),
        ]);

  const engagements = new Map<string, Engagement>(
    engagementDocs.map((doc) => {
      const engagement = fromStored(engagementSchema, doc);
      return [engagement.id, engagement];
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
  const requestItems = requestItemDocs.map((doc) => fromStored(requestItemSchema, doc));
  const documents = documentDocs.map((doc) => fromStored(threadDocumentSchema, doc));

  const threads: InboxThread[] = [];
  for (const [engagementId, engagementActivities] of byEngagement) {
    const engagement = engagements.get(engagementId);
    if (!engagement) {
      // An activity pointing at a deleted engagement cannot become a thread.
      continue;
    }
    const client = clients.get(engagement.clientId);
    const items = requestItems.filter((item) => item.engagementId === engagementId);
    const engagementDocuments = documents.filter((doc) => doc.engagementId === engagementId);
    const unreadCount = engagementActivities.filter(isUnread).length;
    // Activities arrive newest-first, so `find` returns the latest occurrence.
    const requestSent = engagementActivities.find((entry) => entry.action === "request-sent");
    const sentToEngine = engagementActivities.find((entry) => entry.action === "sent-to-engine");

    threads.push(
      inboxThreadSchema.parse({
        engagementId,
        clientName: client?.legalName ?? "Unknown client",
        engagementLabel: `${engagement.filingType} · ${engagement.taxYear}`,
        portalToken: engagement.portalToken,
        requestSentAt: requestSent?.createdAt ?? engagement.createdAt,
        unread: unreadCount > 0,
        unreadCount,
        items: items.map((item) => toThreadItem(item, engagementActivities, engagementDocuments)),
        ...(sentToEngine ? { sentToEngineAt: sentToEngine.createdAt } : {}),
      }),
    );
  }

  return c.json(inboxThreadsResponseSchema.parse({ threads }));
});

inboxRoutes.post("/threads/:engagementId/read", async (c) => {
  const db = await connectDb();
  const engagementId = c.req.param("engagementId");
  const engagementDoc = await engagementsCollection(db).findOne({ _id: engagementId });

  if (!engagementDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  await activitiesCollection(db).updateMany(
    { engagementId, ...unreadFilter },
    { $set: { readAt: new Date().toISOString() } },
  );

  return c.body(null, 204);
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
