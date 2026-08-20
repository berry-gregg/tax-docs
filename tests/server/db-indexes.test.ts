import { afterAll, describe, expect, test } from "bun:test";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import { collectionNames } from "../../src/server/db/collections.ts";

afterAll(async () => {
  await disconnectDb();
});

async function indexKeys(collection: string): Promise<string[]> {
  const db = await connectDb();
  const indexes = await db.collection(collection).indexes();
  return indexes.flatMap((index) => Object.keys(index.key));
}

describe("query indexes", () => {
  test("engagements are indexed for list filters and portal lookups", async () => {
    const keys = await indexKeys(collectionNames.engagements);

    for (const field of ["clientId", "taxYear", "filingType", "status", "createdAt", "portalToken"]) {
      expect(keys).toContain(field);
    }
  });

  test("documents are indexed for list filters", async () => {
    const keys = await indexKeys(collectionNames.taxDocuments);

    for (const field of ["engagementId", "createdAt"]) {
      expect(keys).toContain(field);
    }
  });

  test("activity and request items are indexed by engagement", async () => {
    expect(await indexKeys(collectionNames.activities)).toContain("engagementId");
    expect(await indexKeys(collectionNames.requestItems)).toContain("engagementId");
  });

  test("request items carry a covering index for the portal's required-first checklist sort", async () => {
    const keys = await indexKeys(collectionNames.requestItems);

    for (const field of ["required", "title"]) {
      expect(keys).toContain(field);
    }
  });

  test("messages are indexed by engagement for thread loads", async () => {
    expect(await indexKeys(collectionNames.messages)).toContain("engagementId");
  });
});
