import { z } from "zod";

export const metadataTypeSchema = z.enum([
  "person-name",
  "business-name",
  "address",
  "ein-tin",
  "date",
  "dollar-amount",
  "total",
  "percentage",
  "quantity",
  "boolean-flag",
  "identifier",
  "free-text",
]);
export type MetadataType = z.infer<typeof metadataTypeSchema>;

export const dataTypeSchema = z.enum(["string", "int", "double", "boolean", "date"]);
export type DataType = z.infer<typeof dataTypeSchema>;

const DEFAULT_DATA_TYPE: Record<MetadataType, DataType> = {
  "person-name": "string",
  "business-name": "string",
  address: "string",
  "ein-tin": "string",
  date: "date",
  "dollar-amount": "double",
  total: "double",
  percentage: "double",
  quantity: "int",
  "boolean-flag": "boolean",
  identifier: "string",
  "free-text": "string",
};

export function defaultDataTypeFor(metadataType: MetadataType): DataType {
  return DEFAULT_DATA_TYPE[metadataType];
}

function compilableRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const fieldDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case identifier"),
  label: z.string().min(1).max(120),
  metadataType: metadataTypeSchema,
  dataType: dataTypeSchema,
  required: z.boolean(),
  regex: z.string().refine(compilableRegex, "must compile as a RegExp").optional(),
  description: z.string().min(1).max(500),
});
export type FieldDef = z.infer<typeof fieldDefSchema>;
