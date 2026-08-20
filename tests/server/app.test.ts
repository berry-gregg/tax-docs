import { describe, expect, test } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { connectDb, disconnectDb } from "../../src/server/db/client.ts";
import { recordsCollection } from "../../src/server/db/collections.ts";

describe("health route", () => {
  test("returns ok with connected database", async () => {
    await connectDb();
    const app = createApp();

    const response = await app.request("/api/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      service: "tax-docs",
      database: "connected",
    });

    await disconnectDb();
  });
});

describe("records route", () => {
  test("creates and lists records", async () => {
    await connectDb();
    const app = createApp();

    const createResponse = await app.request("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "W-2 batch" }),
    });

    expect(createResponse.status).toBe(201);

    const listResponse = await app.request("/api/records");
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody.records).toHaveLength(1);
    expect(listBody.records[0].title).toBe("W-2 batch");

    const db = await connectDb();
    await recordsCollection(db).deleteMany({});
    await disconnectDb();
  });
});
