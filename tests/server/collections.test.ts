import { describe, expect, test } from "bun:test";
import type { Client } from "../../src/shared/schemas/client.ts";
import { clientSchema } from "../../src/shared/schemas/client.ts";
import {
  collectionNames,
  fromStored,
  toStored,
  type StoredDoc,
} from "../../src/server/db/collections.ts";

const iso = new Date().toISOString();

const validClient = {
  legalName: "Acme Corp",
  entityType: "s-corp" as const,
  ein: "12-3456789",
  contactName: "Jane Doe",
  contactEmail: "jane@acme.com",
  city: "San Francisco",
  state: "CA",
  createdAt: iso,
};

describe("collectionNames", () => {
  test("uses spec Mongo collection strings for documents, activity, and exports", () => {
    expect(collectionNames.taxDocuments).toBe("documents");
    expect(collectionNames.activities).toBe("activity");
    expect(collectionNames.engineExports).toBe("exports");
  });
});

describe("fromStored / toStored", () => {
  test("fromStored maps _id to id and parses through schema", () => {
    const result = fromStored(clientSchema, { _id: "c1", ...validClient });
    expect(result.id).toBe("c1");
    expect(result.legalName).toBe("Acme Corp");
  });

  test("fromStored throws on malformed doc", () => {
    const { ein: _ein, ...withoutEin } = validClient;
    const malformed = { _id: "c1", ...withoutEin } as StoredDoc<Client>;
    expect(() => fromStored(clientSchema, malformed)).toThrow();
  });

  test("toStored round-trips through fromStored", () => {
    const client = clientSchema.parse({ id: "c1", ...validClient });
    const stored = toStored(client);
    expect(stored._id).toBe("c1");
    expect(stored).not.toHaveProperty("id");
    const roundTripped = fromStored(clientSchema, stored);
    expect(roundTripped).toEqual(client);
  });
});
