import { REGEX_FAIL_CONFIDENCE_CAP } from "../../shared/constants.ts";
import { extractionFieldSchema, type ExtractionField } from "../../shared/schemas/document.ts";
import type { DocumentType } from "../../shared/schemas/document-type.ts";
import type { DataType, FieldDef } from "../../shared/schemas/metadata.ts";
import type { RawExtraction } from "./stages.ts";

const BOOLEAN_TRUE = new Set(["true", "yes", "x", "checked"]);
const BOOLEAN_FALSE = new Set(["false", "no"]);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/;

type RawField = RawExtraction["fields"][number];

function parseSignedNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const negative = trimmed.includes("(") && trimmed.includes(")");
  const cleaned = trimmed.replace(/[$,()]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidYmd(year: number, month: number, day: number): boolean {
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

function coerceDate(raw: string): string | null {
  const trimmed = raw.trim();
  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return isValidYmd(year, month, day) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  return isValidYmd(year, month, day) ? `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}` : null;
}

export function coerceValue(
  raw: string,
  dataType: DataType,
): string | number | boolean | null {
  switch (dataType) {
    case "string":
      return raw;
    case "double":
      return parseSignedNumber(raw);
    case "int": {
      const n = parseSignedNumber(raw);
      return n !== null && Number.isInteger(n) ? n : null;
    }
    case "boolean": {
      const token = raw.trim().toLowerCase();
      if (BOOLEAN_TRUE.has(token)) return true;
      if (BOOLEAN_FALSE.has(token)) return false;
      return null;
    }
    case "date":
      return coerceDate(raw);
  }
}

function regexPassFor(
  def: FieldDef,
  coerced: string | number | boolean | null,
  rawValue: string | null | undefined,
): boolean | null {
  if (def.regex === undefined) return null;
  const testTarget = coerced !== null ? String(coerced) : (rawValue ?? "");
  return new RegExp(def.regex).test(testTarget);
}

function finalizeOne(def: FieldDef, raw: RawField | undefined): ExtractionField {
  if (raw === undefined) {
    return extractionFieldSchema.parse({
      key: def.key,
      label: def.label,
      metadataType: def.metadataType,
      dataType: def.dataType,
      value: null,
      confidence: 0,
      sourceSnippet: "",
      notFound: true,
      regexPass: regexPassFor(def, null, null),
      reviewStatus: "unreviewed",
    });
  }

  const rawValue = raw.value;
  const coerced = rawValue === null ? null : coerceValue(rawValue, def.dataType);
  const notFound = coerced === null;
  const value = coerced;
  let confidence = raw.confidence;
  const regexPass = regexPassFor(def, coerced, rawValue);

  if (regexPass === false) {
    confidence = Math.min(confidence, REGEX_FAIL_CONFIDENCE_CAP);
  }

  return extractionFieldSchema.parse({
    key: def.key,
    label: def.label,
    metadataType: def.metadataType,
    dataType: def.dataType,
    value,
    confidence,
    sourceSnippet: raw.sourceSnippet,
    notFound,
    regexPass,
    reviewStatus: "unreviewed",
  });
}

export function finalizeFields(raw: RawExtraction, docType: DocumentType): ExtractionField[] {
  const byKey = new Map<string, RawField>();
  for (const field of raw.fields) {
    if (byKey.has(field.key)) continue;
    byKey.set(field.key, field);
  }

  return docType.fields.map((def) => finalizeOne(def, byKey.get(def.key)));
}
