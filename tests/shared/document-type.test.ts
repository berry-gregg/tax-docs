import { describe, expect, test } from "bun:test";
import {
  createDocumentTypeInputSchema,
  documentTypeSchema,
} from "../../src/shared/schemas/document-type.ts";
import { requestTemplateSchema } from "../../src/shared/schemas/request.ts";

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
