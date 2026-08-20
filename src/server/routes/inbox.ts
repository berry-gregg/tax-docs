import { Hono } from "hono";
import { activitySchema, type Activity } from "../../shared/schemas/activity.ts";
import { inboxUnreadCountSchema } from "../../shared/schemas/api.ts";
import { clientSchema } from "../../shared/schemas/client.ts";
import { taxDocumentSchema } from "../../shared/schemas/document.ts";
import { engagementSchema, type Engagement } from "../../shared/schemas/engagement.ts";
import {
  createInboxMessageInputSchema,
  inboxMessageResponseSchema,
  inboxThreadSchema,
  inboxThreadsResponseSchema,
  type InboxThread,
  type InboxTimelineEntry,
} from "../../shared/schemas/inbox.ts";
import { messageSchema, type Message } from "../../shared/schemas/message.ts";
import { requestItemSchema } from "../../shared/schemas/request.ts";
import { zodIssueSummary } from "../../shared/zod-issue-summary.ts";
import { connectDb } from "../db/client.ts";
import {
  activitiesCollection,
  clientsCollection,
  engagementsCollection,
  fromStored,
  messagesCollection,
  requestItemsCollection,
  taxDocumentsCollection,
} from "../db/collections.ts";
import { insertMessage, markMessagesRead } from "../db/messages.ts";

export const inboxRoutes = new Hono();

/** Internal activities are pipeline bookkeeping; only the visible ones become timeline events. */
const visibleFilter = { direction: { $ne: "internal" as const } };
/** `$nor $type` (not `$exists`) so a stored `readAt: null` still counts as unread. */
const notReadFilter = { $nor: [{ readAt: { $type: "string" as const } }] };
/** Only inbound items drive unread — the CPA's own outbound never makes their inbox unread. */
const unreadInboundActivityFilter = { direction: "inbound" as const, ...notReadFilter };
const unreadClientMessageFilter = { sender: "client" as const, ...notReadFilter };

function isUnread(entry: { readAt?: string }): boolean {
  return entry.readAt === undefined;
}

/** Lookup slices for grounding event lines: document filenames and request-item titles. */
const eventDocumentSchema = taxDocumentSchema.pick({ id: true, filename: true });
const eventRequestItemSchema = requestItemSchema.pick({ id: true, title: true });

/**
 * Quiet single-line system text for a visible activity. Grounded in looked-up entities where
 * they exist; falls back to the activity's own detail rather than inventing specifics.
 */
function eventText(
  activity: Activity,
  filenames: Map<string, string>,
  itemTitles: Map<string, string>,
): string {
  const filename = activity.documentId ? filenames.get(activity.documentId) : undefined;
  const itemTitle = activity.requestItemId ? itemTitles.get(activity.requestItemId) : undefined;

  switch (activity.action) {
    case "request-sent":
      return "Request sent";
    case "engagement-created":
      return "Engagement created";
    case "document-uploaded":
      return filename ? `Client uploaded ${filename}` : activity.detail;
    case "document-extracted":
      return filename ? `Extracted ${filename}` : activity.detail;
    case "checklist-item-matched":
      return itemTitle ? `Matched to ${itemTitle}` : activity.detail;
    case "request-item-added":
      return `Requested ${itemTitle ?? activity.detail}`;
    case "request-item-waived":
      return activity.actor === "client"
        ? `Client waived ${itemTitle ?? activity.detail}`
        : `Waived ${itemTitle ?? activity.detail}`;
    case "sent-to-engine":
      return "Sent to tax engine";
    default:
      return activity.detail.length > 0 ? activity.detail : activity.action;
  }
}

function toTimeline(
  messages: Message[],
  activities: Activity[],
  filenames: Map<string, string>,
  itemTitles: Map<string, string>,
): InboxTimelineEntry[] {
  const entries: InboxTimelineEntry[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      id: message.id,
      sender: message.sender,
      body: message.body,
      createdAt: message.createdAt,
    })),
    ...activities.map((activity) => ({
      kind: "event" as const,
      id: activity.id,
      text: eventText(activity, filenames, itemTitles),
      ...(activity.documentId ? { documentId: activity.documentId } : {}),
      createdAt: activity.createdAt,
    })),
  ];

  // ISO strings compare lexicographically; the sort is stable so same-instant items keep
  // messages-before-events insertion order.
  return entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

inboxRoutes.get("/unread-count", async (c) => {
  const db = await connectDb();
  const [messageEngagementIds, activityEngagementIds] = await Promise.all([
    messagesCollection(db).distinct("engagementId", unreadClientMessageFilter),
    activitiesCollection(db).distinct("engagementId", unreadInboundActivityFilter),
  ]);
  const count = new Set([...messageEngagementIds, ...activityEngagementIds]).size;

  return c.json(inboxUnreadCountSchema.parse({ count }));
});

inboxRoutes.get("/", async (c) => {
  const db = await connectDb();
  const [messageDocs, activityDocs] = await Promise.all([
    messagesCollection(db).find({}).sort({ createdAt: 1, _id: 1 }).toArray(),
    activitiesCollection(db).find(visibleFilter).sort({ createdAt: 1, _id: 1 }).toArray(),
  ]);
  const messagesByEngagement = new Map<string, Message[]>();
  for (const doc of messageDocs) {
    const message = fromStored(messageSchema, doc);
    const group = messagesByEngagement.get(message.engagementId);
    if (group) {
      group.push(message);
    } else {
      messagesByEngagement.set(message.engagementId, [message]);
    }
  }
  const activitiesByEngagement = new Map<string, Activity[]>();
  for (const doc of activityDocs) {
    const activity = fromStored(activitySchema, doc);
    const group = activitiesByEngagement.get(activity.engagementId);
    if (group) {
      group.push(activity);
    } else {
      activitiesByEngagement.set(activity.engagementId, [activity]);
    }
  }

  // A thread exists for every engagement that has messages or visible activities.
  const engagementIds = [
    ...new Set([...messagesByEngagement.keys(), ...activitiesByEngagement.keys()]),
  ];
  if (engagementIds.length === 0) {
    return c.json(inboxThreadsResponseSchema.parse({ threads: [] }));
  }

  const [engagementDocs, documentDocs, requestItemDocs] = await Promise.all([
    engagementsCollection(db)
      .find({ _id: { $in: engagementIds } })
      .toArray(),
    taxDocumentsCollection(db)
      .find({ engagementId: { $in: engagementIds } }, { projection: { _id: 1, filename: 1 } })
      .toArray(),
    requestItemsCollection(db)
      .find({ engagementId: { $in: engagementIds } }, { projection: { _id: 1, title: 1 } })
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
  const filenames = new Map(
    documentDocs.map((doc) => {
      const document = fromStored(eventDocumentSchema, doc);
      return [document.id, document.filename] as const;
    }),
  );
  const itemTitles = new Map(
    requestItemDocs.map((doc) => {
      const item = fromStored(eventRequestItemSchema, doc);
      return [item.id, item.title] as const;
    }),
  );

  const threads: InboxThread[] = [];
  for (const engagementId of engagementIds) {
    const engagement = engagements.get(engagementId);
    if (!engagement) {
      // Messages or activities pointing at a deleted engagement cannot become a thread.
      continue;
    }
    const messages = messagesByEngagement.get(engagementId) ?? [];
    const activities = activitiesByEngagement.get(engagementId) ?? [];
    const unreadCount =
      messages.filter((message) => message.sender === "client" && isUnread(message)).length +
      activities.filter((activity) => activity.direction === "inbound" && isUnread(activity)).length;

    threads.push(
      inboxThreadSchema.parse({
        engagementId,
        clientName: clients.get(engagement.clientId)?.legalName ?? "Unknown client",
        taxYear: engagement.taxYear,
        filingType: engagement.filingType,
        portalToken: engagement.portalToken,
        unread: unreadCount > 0,
        unreadCount,
        timeline: toTimeline(messages, activities, filenames, itemTitles),
      }),
    );
  }

  // Freshest conversation first: latest timeline entry (message or event) wins.
  threads.sort((a, b) => {
    const lastA = a.timeline.at(-1)?.createdAt ?? "";
    const lastB = b.timeline.at(-1)?.createdAt ?? "";
    return lastA < lastB ? 1 : lastA > lastB ? -1 : 0;
  });

  return c.json(inboxThreadsResponseSchema.parse({ threads }));
});

inboxRoutes.post("/threads/:engagementId/messages", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createInboxMessageInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: zodIssueSummary(parsed.error) }, 400);
  }

  const db = await connectDb();
  const engagementId = c.req.param("engagementId");
  const engagementDoc = await engagementsCollection(db).findOne({ _id: engagementId });

  if (!engagementDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  const message = await insertMessage(db, {
    engagementId,
    sender: "cpa",
    body: parsed.data.body,
  });

  return c.json(inboxMessageResponseSchema.parse({ message }), 201);
});

inboxRoutes.post("/threads/:engagementId/read", async (c) => {
  const db = await connectDb();
  const engagementId = c.req.param("engagementId");
  const engagementDoc = await engagementsCollection(db).findOne({ _id: engagementId });

  if (!engagementDoc) {
    return c.json({ error: "Not found" }, 404);
  }

  await Promise.all([
    // The CPA read the client's messages; the CPA's own messages belong to the portal's read state.
    markMessagesRead(db, engagementId, "client"),
    activitiesCollection(db).updateMany(
      { engagementId, ...visibleFilter, ...notReadFilter },
      { $set: { readAt: new Date().toISOString() } },
    ),
  ]);

  return c.body(null, 204);
});
