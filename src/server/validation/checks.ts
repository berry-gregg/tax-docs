import type { ExtractionField, TaxDocument } from "../../shared/schemas/document.ts";
import { taxDocumentSchema } from "../../shared/schemas/document.ts";
import { requestItemSchema, type RequestItem } from "../../shared/schemas/request.ts";
import { validationCheckSchema, type ValidationCheck } from "../../shared/schemas/validation.ts";
import { connectDb } from "../db/client.ts";
import {
  fromStored,
  requestItemsCollection,
  taxDocumentsCollection,
} from "../db/collections.ts";

const TOLERANCE = 0.01;
const REVIEWABLE_STATUSES = new Set<TaxDocument["pipelineStatus"]>(["needs-review", "trusted"]);
const EIN_FIELD_KEYS = new Set(["employer_ein", "partnership_ein", "corporation_ein", "payer_tin"]);

function check(input: ValidationCheck): ValidationCheck {
  return validationCheckSchema.parse(input);
}

function documentTypeId(document: TaxDocument): string | null {
  return document.classification?.documentTypeId ?? null;
}

function participates(document: TaxDocument): boolean {
  return REVIEWABLE_STATUSES.has(document.pipelineStatus) && Boolean(document.extraction);
}

function effectiveValue(field: ExtractionField) {
  return field.editedValue ?? field.value;
}

function field(document: TaxDocument, key: string): ExtractionField | undefined {
  return document.extraction?.fields.find((candidate) => candidate.key === key);
}

function numericField(document: TaxDocument, key: string): number | null {
  const value = field(document, key);
  const effective = value ? effectiveValue(value) : null;

  return typeof effective === "number" ? effective : null;
}

function stringField(document: TaxDocument, key: string): string | null {
  const value = field(document, key);
  const effective = value ? effectiveValue(value) : null;

  return typeof effective === "string" ? effective : null;
}

function withinTolerance(left: number, right: number, tolerance = TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function normalizeTin(value: string): string {
  return value.replace(/\D/g, "");
}

function buildBalanceSheetCheck(document: TaxDocument): ValidationCheck | null {
  const totalAssets = numericField(document, "total_assets");
  const totalLiabilities = numericField(document, "total_liabilities");
  const totalEquity = numericField(document, "total_equity");

  if (totalAssets === null || totalLiabilities === null || totalEquity === null) {
    return null;
  }

  const liabilitiesAndEquity = totalLiabilities + totalEquity;
  const passes = withinTolerance(totalAssets, liabilitiesAndEquity);

  return check({
    checkId: "balance-sheet-ties",
    label: "Balance sheet ties",
    status: passes ? "pass" : "warn",
    explanation: `Assets ${formatMoney(totalAssets)} ${
      passes ? "tie to" : "do not tie to"
    } liabilities plus equity ${formatMoney(liabilitiesAndEquity)}.`,
    relatedDocumentIds: [document.id],
  });
}

function buildTrialBalanceCheck(document: TaxDocument): ValidationCheck | null {
  const totalDebits = numericField(document, "total_debits");
  const totalCredits = numericField(document, "total_credits");

  if (totalDebits === null || totalCredits === null) {
    return null;
  }

  const passes = withinTolerance(totalDebits, totalCredits);

  return check({
    checkId: "trial-balance-ties",
    label: "Trial balance ties",
    status: passes ? "pass" : "warn",
    explanation: `Total debits ${formatMoney(totalDebits)} ${
      passes ? "tie to" : "do not tie to"
    } total credits ${formatMoney(totalCredits)}.`,
    relatedDocumentIds: [document.id],
  });
}

function buildProfitLossCheck(document: TaxDocument): ValidationCheck | null {
  const netIncome = numericField(document, "net_income");
  const grossReceipts = numericField(document, "gross_receipts");
  const totalExpenses = numericField(document, "total_expenses");

  if (netIncome === null || grossReceipts === null || totalExpenses === null) {
    return null;
  }

  const computedNetIncome = grossReceipts - totalExpenses;
  const passes = withinTolerance(netIncome, computedNetIncome);

  return check({
    checkId: "pl-foots",
    label: "P&L foots",
    status: passes ? "pass" : "warn",
    explanation: `Net income ${formatMoney(netIncome)} ${
      passes ? "matches" : "does not match"
    } gross receipts minus expenses ${formatMoney(computedNetIncome)}.`,
    relatedDocumentIds: [document.id],
  });
}

function buildEinConsistencyCheck(documents: TaxDocument[]): ValidationCheck | null {
  const values = documents.flatMap((document) =>
    [...EIN_FIELD_KEYS].flatMap((key) => {
      const value = stringField(document, key);
      const normalized = value ? normalizeTin(value) : "";

      return normalized ? [{ documentId: document.id, value: normalized }] : [];
    }),
  );

  if (values.length === 0) {
    return null;
  }

  const distinctValues = [...new Set(values.map((entry) => entry.value))];
  const relatedDocumentIds = [...new Set(values.map((entry) => entry.documentId))];
  const passes = distinctValues.length === 1;

  return check({
    checkId: "ein-consistency",
    label: "EIN consistency",
    status: passes ? "pass" : "warn",
    explanation: passes
      ? `EIN/TIN values are consistent at ${distinctValues[0]}.`
      : `EIN/TIN values differ across documents: ${distinctValues.join(", ")}.`,
    relatedDocumentIds,
  });
}

function buildPayrollTieCheck(documents: TaxDocument[]): ValidationCheck | null {
  const profitLoss = documents.find((document) => documentTypeId(document) === "dt-profit-loss");
  const forms941 = documents.filter((document) => documentTypeId(document) === "dt-941");

  if (!profitLoss || forms941.length === 0) {
    return null;
  }

  const salariesWages = numericField(profitLoss, "salaries_wages");
  const officerCompensation = numericField(profitLoss, "officer_compensation");
  const form941Wages = forms941.map((document) => numericField(document, "wages_tips_compensation"));
  const presentForm941Wages = form941Wages.filter((value): value is number => value !== null);

  if (
    salariesWages === null ||
    officerCompensation === null ||
    presentForm941Wages.length !== forms941.length
  ) {
    return null;
  }

  const form941Total = presentForm941Wages.reduce((sum, value) => sum + value, 0);
  const profitLossPayroll = salariesWages + officerCompensation;
  const difference = Math.abs(form941Total - profitLossPayroll);
  const tolerance = Math.abs(profitLossPayroll) * 0.01;
  const passes = difference <= tolerance;

  return check({
    checkId: "payroll-tie",
    label: "Payroll ties to P&L",
    status: passes ? "pass" : "warn",
    explanation: `941 wages total ${formatMoney(form941Total)} ${
      passes ? "ties to" : "but P&L payroll is"
    } ${formatMoney(profitLossPayroll)} (difference ${formatMoney(difference)}).`,
    relatedDocumentIds: [profitLoss.id, ...forms941.map((document) => document.id)],
  });
}

function buildMissingRequiredItemsCheck(requestItems: RequestItem[]): ValidationCheck {
  const openRequiredItems = requestItems.filter((item) => item.required && item.status === "open");

  return check({
    checkId: "missing-required-items",
    label: "Missing required items",
    status: openRequiredItems.length === 0 ? "pass" : "warn",
    explanation:
      openRequiredItems.length === 0
        ? "No required request items are still open."
        : `Required request items are still open: ${openRequiredItems
            .map((item) => item.title)
            .join(", ")}.`,
    relatedDocumentIds: [],
  });
}

function orderedDocuments(documents: TaxDocument[]): TaxDocument[] {
  return [...documents].sort((left, right) => {
    const createdAtOrder = left.createdAt.localeCompare(right.createdAt);

    return createdAtOrder === 0 ? left.id.localeCompare(right.id) : createdAtOrder;
  });
}

export async function computeValidations(engagementId: string): Promise<ValidationCheck[]> {
  const db = await connectDb();
  const [documentDocs, requestItemDocs] = await Promise.all([
    taxDocumentsCollection(db).find({ engagementId }).toArray(),
    requestItemsCollection(db).find({ engagementId }).sort({ title: 1 }).toArray(),
  ]);
  const documents = orderedDocuments(
    documentDocs.map((document) => fromStored(taxDocumentSchema, document)).filter(participates),
  );
  const requestItems = requestItemDocs.map((item) => fromStored(requestItemSchema, item));
  const checks: ValidationCheck[] = [];

  for (const document of documents) {
    const typeId = documentTypeId(document);

    if (typeId === "dt-balance-sheet") {
      const balanceSheetCheck = buildBalanceSheetCheck(document);
      if (balanceSheetCheck) checks.push(balanceSheetCheck);
    }

    if (typeId === "dt-trial-balance") {
      const trialBalanceCheck = buildTrialBalanceCheck(document);
      if (trialBalanceCheck) checks.push(trialBalanceCheck);
    }

    if (typeId === "dt-profit-loss") {
      const profitLossCheck = buildProfitLossCheck(document);
      if (profitLossCheck) checks.push(profitLossCheck);
    }
  }

  const einConsistencyCheck = buildEinConsistencyCheck(documents);
  if (einConsistencyCheck) checks.push(einConsistencyCheck);

  const payrollTieCheck = buildPayrollTieCheck(documents);
  if (payrollTieCheck) checks.push(payrollTieCheck);

  checks.push(buildMissingRequiredItemsCheck(requestItems));

  return checks;
}
