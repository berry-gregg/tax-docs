import { describe, expect, test } from "bun:test";
import {
  dataTypeSchema,
  defaultDataTypeFor,
  fieldDefSchema,
  metadataTypeSchema,
} from "../../src/shared/schemas/metadata.ts";

describe("metadata types", () => {
  test("every metadata type has a default data type", () => {
    for (const mt of metadataTypeSchema.options) {
      expect(dataTypeSchema.options).toContain(defaultDataTypeFor(mt));
    }
  });

  test("money-like metadata defaults to double, flags to boolean, dates to date", () => {
    expect(defaultDataTypeFor("dollar-amount")).toBe("double");
    expect(defaultDataTypeFor("total")).toBe("double");
    expect(defaultDataTypeFor("boolean-flag")).toBe("boolean");
    expect(defaultDataTypeFor("date")).toBe("date");
    expect(defaultDataTypeFor("ein-tin")).toBe("string");
    expect(defaultDataTypeFor("quantity")).toBe("int");
  });

  test("field definitions validate regex as an optional compilable pattern", () => {
    const good = fieldDefSchema.parse({
      key: "employer_ein",
      label: "Employer EIN",
      metadataType: "ein-tin",
      dataType: "string",
      required: true,
      regex: "^\\d{2}-\\d{7}$",
      description: "Box b employer identification number",
    });
    expect(good.regex).toBe("^\\d{2}-\\d{7}$");
    expect(() =>
      fieldDefSchema.parse({ ...good, regex: "([unclosed" }),
    ).toThrow();
  });

  test("field keys are snake_case identifiers", () => {
    expect(() =>
      fieldDefSchema.parse({
        key: "Bad Key!",
        label: "x",
        metadataType: "free-text",
        dataType: "string",
        required: false,
        description: "d",
      }),
    ).toThrow();
  });
});
