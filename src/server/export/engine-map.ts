import type { ExportLine } from "../../shared/schemas/export.ts";
import { exportLineSchema } from "../../shared/schemas/export.ts";
import type { FilingType } from "../../shared/schemas/engagement.ts";
import { engagementSchema } from "../../shared/schemas/engagement.ts";
import { taxDocumentSchema, type ExtractionField } from "../../shared/schemas/document.ts";
import { connectDb } from "../db/client.ts";
import {
  engagementsCollection,
  fromStored,
  taxDocumentsCollection,
} from "../db/collections.ts";

export type EngineLineDef = {
  engineForm: string;
  lineId: string;
  lineLabel: string;
  source: { documentTypeId: string; fieldKey: string };
};

export const ENGINE_LINE_MAP: Record<FilingType, EngineLineDef[]> = {
  "1120-S": [
    line("Form 1120-S", "1a", "Gross receipts", "dt-profit-loss", "gross_receipts"),
    line("Form 1120-S", "7", "Compensation of officers", "dt-profit-loss", "officer_compensation"),
    line("Form 1120-S", "8", "Salaries and wages", "dt-profit-loss", "salaries_wages"),
    line("Form 1120-S", "11", "Rents", "dt-profit-loss", "rents"),
    line("Form 1120-S", "12", "Taxes and licenses", "dt-profit-loss", "taxes_licenses"),
    line("Form 1120-S", "14", "Depreciation", "dt-profit-loss", "depreciation"),
    line("Form 1120-S", "16", "Advertising", "dt-profit-loss", "advertising"),
    line("Form 1120-S", "21", "Ordinary business income", "dt-profit-loss", "net_income"),
    line("Schedule K", "1", "Ordinary business income", "dt-profit-loss", "net_income"),
    line("Item F", "total-assets", "Total assets", "dt-balance-sheet", "total_assets"),
  ],
  "1065": [
    line("Form 1065", "1a", "Gross receipts", "dt-profit-loss", "gross_receipts"),
    line("Form 1065", "9", "Salaries and wages", "dt-profit-loss", "salaries_wages"),
    line("Form 1065", "13", "Rent", "dt-profit-loss", "rents"),
    line("Form 1065", "14", "Taxes and licenses", "dt-profit-loss", "taxes_licenses"),
    line("Form 1065", "16a", "Depreciation", "dt-profit-loss", "depreciation"),
    line("Form 1065", "22", "Ordinary business income", "dt-profit-loss", "net_income"),
    line("Schedule K", "1", "Ordinary business income", "dt-profit-loss", "net_income"),
    line("Schedule L", "total-assets", "Total assets", "dt-balance-sheet", "total_assets"),
  ],
};

function line(
  engineForm: string,
  lineId: string,
  lineLabel: string,
  documentTypeId: string,
  fieldKey: string,
): EngineLineDef {
  return {
    engineForm,
    lineId,
    lineLabel,
    source: { documentTypeId, fieldKey },
  };
}

function effectiveValue(field: ExtractionField): string | number | boolean | null {
  return field.editedValue ?? field.value;
}

export async function buildExportLines(engagementId: string): Promise<ExportLine[]> {
  const db = await connectDb();
  const engagementDoc = await engagementsCollection(db).findOne({ _id: engagementId });
  if (!engagementDoc) {
    return [];
  }

  const engagement = fromStored(engagementSchema, engagementDoc);
  const trustedDocs = (
    await taxDocumentsCollection(db)
      .find({ engagementId, pipelineStatus: "trusted" })
      // _id tiebreak keeps sourceRefs deterministic when uploads share a createdAt timestamp.
      .sort({ createdAt: 1, _id: 1 })
      .toArray()
  ).map((doc) => fromStored(taxDocumentSchema, doc));

  return ENGINE_LINE_MAP[engagement.filingType].map((lineDef) => {
    const matches = trustedDocs.flatMap((document) => {
      if (document.classification?.documentTypeId !== lineDef.source.documentTypeId) {
        return [];
      }

      const field = document.extraction?.fields.find((candidate) => candidate.key === lineDef.source.fieldKey);
      if (!field) {
        return [];
      }

      const value = effectiveValue(field);
      if (value === null) {
        return [];
      }

      return [{ documentId: document.id, fieldKey: field.key, value }];
    });
    const numericValues = matches
      .map((match) => match.value)
      .filter((value): value is number => typeof value === "number");

    return exportLineSchema.parse({
      engineForm: lineDef.engineForm,
      lineId: lineDef.lineId,
      lineLabel: lineDef.lineLabel,
      value:
        matches.length === 0
          ? null
          : numericValues.length === matches.length
            ? numericValues.reduce((sum, value) => sum + value, 0)
            : matches[0]?.value ?? null,
      sourceRefs: matches.map(({ documentId, fieldKey }) => ({ documentId, fieldKey })),
    });
  });
}
