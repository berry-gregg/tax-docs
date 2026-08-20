import { describe, expect, test } from "bun:test";
import { seedDocumentTypes, seedRequestTemplates } from "../../src/server/seed/definitions.ts";
import { documentTypeSchema } from "../../src/shared/schemas/document-type.ts";
import { requestTemplateSchema } from "../../src/shared/schemas/request.ts";

describe("seed definitions", () => {
  test("every seeded document type parses and is active", () => {
    for (const dt of seedDocumentTypes) {
      expect(documentTypeSchema.parse(dt).active).toBe(true);
    }
    expect(seedDocumentTypes.map((d) => d.id).sort()).toEqual([
      "dt-1099-nec",
      "dt-941",
      "dt-balance-sheet",
      "dt-fixed-assets",
      "dt-k1-1065",
      "dt-k1-1120s",
      "dt-profit-loss",
      "dt-trial-balance",
    ]);
  });

  test("941 has the payroll tie fields with EIN regex", () => {
    const dt941 = seedDocumentTypes.find((d) => d.id === "dt-941");
    const ein = dt941?.fields.find((f) => f.key === "employer_ein");
    expect(ein?.regex).toBe("^\\d{2}-\\d{7}$");
    expect(dt941?.fields.some((f) => f.key === "wages_tips_compensation")).toBe(true);
  });

  test("templates parse and reference existing document types", () => {
    const ids = new Set(seedDocumentTypes.map((d) => d.id));
    for (const tpl of seedRequestTemplates) {
      requestTemplateSchema.parse(tpl);
      for (const item of tpl.items) expect(ids.has(item.documentTypeId)).toBe(true);
    }
    expect(seedRequestTemplates.map((t) => t.filingType).sort()).toEqual(["1065", "1120-S"]);
  });
});
