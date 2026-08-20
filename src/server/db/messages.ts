import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { messageSchema, type Message, type MessageSender } from "../../shared/schemas/message.ts";
import { fromStored, messagesCollection, toStored } from "./collections.ts";

export type MessageInput = {
  engagementId: string;
  sender: MessageSender;
  body: string;
};

/** Same-millisecond inserts (seed, tests) must still list in insertion order, so stamps are strictly increasing. */
let lastStampMs = 0;
function nextCreatedAt(): string {
  lastStampMs = Math.max(Date.now(), lastStampMs + 1);
  return new Date(lastStampMs).toISOString();
}

/** Single write path for conversation messages — every route inserts through the schema. */
export async function insertMessage(db: Db, input: MessageInput): Promise<Message> {
  const message = messageSchema.parse({
    id: randomUUID(),
    engagementId: input.engagementId,
    sender: input.sender,
    body: input.body,
    createdAt: nextCreatedAt(),
  });

  await messagesCollection(db).insertOne(toStored(message));
  return message;
}

/** Full thread for one engagement, oldest first. `_id` tiebreak keeps same-timestamp order stable. */
export async function listMessages(db: Db, engagementId: string): Promise<Message[]> {
  const stored = await messagesCollection(db)
    .find({ engagementId })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return stored.map((doc) => fromStored(messageSchema, doc));
}

/**
 * Stamp the counterpart's view: marks the given sender's unread messages in the thread as read.
 * Idempotent — already-read messages keep their original timestamp.
 */
export async function markMessagesRead(
  db: Db,
  engagementId: string,
  sender: MessageSender,
): Promise<void> {
  await messagesCollection(db).updateMany(
    { engagementId, sender, readAt: { $not: { $type: "string" } } },
    { $set: { readAt: new Date().toISOString() } },
  );
}
