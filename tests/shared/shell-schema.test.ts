import { describe, expect, test } from "bun:test";
import { documentRowSchema } from "../../src/shared/schemas/shell.ts";

describe("shell document row schema", () => {
  test("accepts a complete row and rejects an unknown status", () => {
    const row = documentRowSchema.parse({
      id: "doc-1",
      name: "2025 W-2",
      type: "W-2",
      client: "Northwind Partners",
      clientMeta: "Partnership · Boston",
      date: "Mar 12, 2026",
      status: "needs-review",
      statusLabel: "Needs review",
      initials: "NP",
    });

    expect(row.type).toBe("W-2");

    const invalid: unknown = {
      id: row.id,
      name: row.name,
      type: row.type,
      client: row.client,
      clientMeta: row.clientMeta,
      date: row.date,
      status: "done",
      statusLabel: row.statusLabel,
      initials: row.initials,
    };

    expect(() => documentRowSchema.parse(invalid)).toThrow();
  });
});
