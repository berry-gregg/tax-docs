import { describe, expect, test } from "bun:test";
import { shouldUseMemoryServer } from "../../src/server/db/client.ts";

/**
 * Tests must never share a database with a running dev server: every `bun test` process
 * (NODE_ENV=test under Bun) gets its own in-memory MongoDB even when MONGODB_URI is set,
 * because test setup wipes collections with deleteMany({}).
 */
describe("shouldUseMemoryServer", () => {
  test("ignores a configured MONGODB_URI when running under bun test", () => {
    expect(shouldUseMemoryServer("test", "mongodb://127.0.0.1:27017")).toBe(true);
  });

  test("uses the configured MONGODB_URI outside of tests", () => {
    expect(shouldUseMemoryServer("development", "mongodb://127.0.0.1:27017")).toBe(false);
    expect(shouldUseMemoryServer("production", "mongodb://127.0.0.1:27017")).toBe(false);
  });

  test("falls back to the memory server when no URI is configured", () => {
    expect(shouldUseMemoryServer("development", undefined)).toBe(true);
  });
});
