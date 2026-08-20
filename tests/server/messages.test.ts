import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import { messagesCollection } from "../../src/server/db/collections.ts";
import { insertMessage, listMessages, markMessagesRead } from "../../src/server/db/messages.ts";
import { messageSchema } from "../../src/shared/schemas/message.ts";

const ENGAGEMENT_ID = "eng-messages-test";
const OTHER_ENGAGEMENT_ID = "eng-messages-other";

beforeEach(async () => {
  const db = await connectDb();
  await messagesCollection(db).deleteMany({
    engagementId: { $in: [ENGAGEMENT_ID, OTHER_ENGAGEMENT_ID] },
  });
});

afterAll(async () => {
  await disconnectDb();
});

describe("message helpers", () => {
  test("insertMessage stores a schema-valid message and returns it", async () => {
    const db = await connectDb();

    const message = await insertMessage(db, {
      engagementId: ENGAGEMENT_ID,
      sender: "cpa",
      body: "We still need your December bank statement.",
    });

    expect(messageSchema.parse(message)).toEqual(message);
    expect(message.readAt).toBeUndefined();

    const listed = await listMessages(db, ENGAGEMENT_ID);
    expect(listed).toEqual([message]);
  });

  test("listMessages returns only that engagement's thread, oldest first", async () => {
    const db = await connectDb();

    const first = await insertMessage(db, {
      engagementId: ENGAGEMENT_ID,
      sender: "cpa",
      body: "Request sent.",
    });
    const second = await insertMessage(db, {
      engagementId: ENGAGEMENT_ID,
      sender: "client",
      body: "On it — uploading this week.",
    });
    await insertMessage(db, {
      engagementId: OTHER_ENGAGEMENT_ID,
      sender: "cpa",
      body: "Different thread.",
    });

    const listed = await listMessages(db, ENGAGEMENT_ID);

    expect(listed.map((message) => message.id)).toEqual([first.id, second.id]);
  });

  test("markMessagesRead stamps only the given sender's unread messages in the thread", async () => {
    const db = await connectDb();

    const clientMessage = await insertMessage(db, {
      engagementId: ENGAGEMENT_ID,
      sender: "client",
      body: "Question about the K-1s.",
    });
    const cpaMessage = await insertMessage(db, {
      engagementId: ENGAGEMENT_ID,
      sender: "cpa",
      body: "Answered below.",
    });
    const otherThread = await insertMessage(db, {
      engagementId: OTHER_ENGAGEMENT_ID,
      sender: "client",
      body: "Unrelated thread stays unread.",
    });

    await markMessagesRead(db, ENGAGEMENT_ID, "client");

    const listed = await listMessages(db, ENGAGEMENT_ID);
    const readClient = listed.find((message) => message.id === clientMessage.id);
    const untouchedCpa = listed.find((message) => message.id === cpaMessage.id);
    expect(typeof readClient?.readAt).toBe("string");
    expect(untouchedCpa?.readAt).toBeUndefined();

    const other = await listMessages(db, OTHER_ENGAGEMENT_ID);
    expect(other.find((message) => message.id === otherThread.id)?.readAt).toBeUndefined();
  });

  test("markMessagesRead is idempotent and preserves the first read timestamp", async () => {
    const db = await connectDb();

    const message = await insertMessage(db, {
      engagementId: ENGAGEMENT_ID,
      sender: "client",
      body: "Read me twice.",
    });

    await markMessagesRead(db, ENGAGEMENT_ID, "client");
    const [afterFirst] = await listMessages(db, ENGAGEMENT_ID);
    await markMessagesRead(db, ENGAGEMENT_ID, "client");
    const [afterSecond] = await listMessages(db, ENGAGEMENT_ID);

    expect(message.id).toBe(afterFirst?.id ?? "");
    expect(afterFirst?.readAt).toBeDefined();
    expect(afterSecond?.readAt).toBe(afterFirst?.readAt);
  });

  test("insertMessage rejects an empty body at the schema boundary", async () => {
    const db = await connectDb();

    await expect(
      insertMessage(db, { engagementId: ENGAGEMENT_ID, sender: "client", body: "" }),
    ).rejects.toThrow();
  });
});
