import { describe, expect, test } from "bun:test";
import {
  createDocumentTypeInputSchema,
  documentTypeSchema,
} from "../../src/shared/schemas/document-type.ts";
import {
  createRequestItemInputSchema,
  requestItemSchema,
  requestTemplateSchema,
} from "../../src/shared/schemas/request.ts";

const field = {
  key: "wages_tips_compensation",
  label: "Wages, tips, compensation",
  metadataType: "dollar-amount",
  dataType: "double",
  required: true,
  description: "Line 2 total wages",
};

describe("documentType schema", () => {
  test("round-trips a full definition", () => {
    const dt = documentTypeSchema.parse({
      id: "dt-941",
      name: "Form 941",
      description: "Quarterly payroll return",
      active: true,
      createdBy: "seed",
      fields: [field],
      createdAt: new Date().toISOString(),
    });
    expect(dt.fields[0]?.dataType).toBe("double");
  });

  test("create input requires at least one field and no id", () => {
    expect(() =>
      createDocumentTypeInputSchema.parse({ name: "X", description: "d", fields: [] }),
    ).toThrow();
  });
});

describe("requestTemplate schema", () => {
  test("items reference a documentTypeId and filing type is constrained", () => {
    const tpl = requestTemplateSchema.parse({
      id: "tpl-1120s",
      filingType: "1120-S",
      items: [
        {
          title: "Quarterly 941s",
          description: "All four quarters",
          documentTypeId: "dt-941",
          required: true,
        },
      ],
    });
    expect(tpl.filingType).toBe("1120-S");
    expect(() => requestTemplateSchema.parse({ ...tpl, filingType: "1040" })).toThrow();
  });
});

describe("requestItem schema", () => {
  const item = {
    id: "item-941-q1",
    engagementId: "eng-1",
    documentTypeId: "dt-941",
    title: "Q1 Form 941",
    description: "First quarter payroll return",
    required: true,
    status: "open",
    matchedDocumentIds: [],
    createdAt: "2026-01-05T00:00:00.000Z",
  };

  test("carries a createdAt so the oldest open item can be ordered", () => {
    expect(requestItemSchema.parse(item).createdAt).toBe("2026-01-05T00:00:00.000Z");
  });

  test("rejects a missing or non-datetime createdAt", () => {
    const { createdAt: _omitted, ...withoutCreatedAt } = item;
    expect(() => requestItemSchema.parse(withoutCreatedAt)).toThrow();
    expect(() => requestItemSchema.parse({ ...item, createdAt: "2026-01-05" })).toThrow();
  });

  test("create input is server-stamped, so it never accepts a caller createdAt", () => {
    const parsed = createRequestItemInputSchema.parse({
      documentTypeId: "dt-941",
      title: "Q1 Form 941",
      description: "First quarter payroll return",
      required: true,
      createdAt: "1999-01-01T00:00:00.000Z",
    });
    expect(parsed).not.toHaveProperty("createdAt");
  });
});
