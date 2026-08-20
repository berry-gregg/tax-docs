/**
 * Demo document pack generator.
 *
 * Produces the tracked `demo-docs/` pack: a fictional S corporation's prepared
 * tax-year 2025 return package, a smaller two-partner LLC package, and two
 * deliberate "bait" documents used to demo the quality-review rejection and the
 * fail-soft define-a-new-type path.
 *
 * Run with `bun run demo-docs`. Output is byte-for-byte idempotent: every
 * document carries a fixed creation/modification date and uses standard
 * (non-subset) fonts, so re-running produces identical files.
 *
 * ---------------------------------------------------------------------------
 * AUTHORITATIVE SOURCES (fetched over HTTPS from irs.gov, 2026-08-19)
 * ---------------------------------------------------------------------------
 * Blank fillable forms — the tax-year 2025 revisions, not the current-year
 * revisions. IRS issues information returns up to a year ahead of the year they
 * report (see the "Which Revision To Use for Which Year" notice on page 1 of
 * f1099nec.pdf), so the newest PDF on irs.gov is the wrong form for TY2025.
 *
 *   Form 941 (Rev. March 2025), Employer's QUARTERLY Federal Tax Return
 *     https://www.irs.gov/pub/irs-prior/f941--2025.pdf
 *   Instructions for Form 941 (Rev. March 2025)
 *     https://www.irs.gov/pub/irs-prior/i941--2025.pdf
 *   Form 1099-NEC (Rev. April 2025), Nonemployee Compensation
 *     https://www.irs.gov/pub/irs-prior/f1099nec--2025.pdf
 *   Instructions for Forms 1099-MISC and 1099-NEC
 *     https://www.irs.gov/pub/irs-pdf/i1099mec.pdf
 *   2025 Schedule K-1 (Form 1120-S), Shareholder's Share of Income...
 *     https://www.irs.gov/pub/irs-pdf/f1120ssk.pdf
 *   Shareholder's Instructions for Schedule K-1 (Form 1120-S)
 *     https://www.irs.gov/pub/irs-pdf/i1120ssk.pdf
 *   2024 Schedule K-1 (Form 1065), Partner's Share of Income, Deductions...
 *     https://www.irs.gov/pub/irs-prior/f1065sk1--2024.pdf
 *   Partner's Instructions for Schedule K-1 (Form 1065) (2024)
 *     https://www.irs.gov/pub/irs-prior/i1065sk1--2024.pdf
 *
 * Box codes used below were read out of those instruction PDFs, not from memory:
 *   1120-S K-1 box 16 code D  = Distributions
 *   1120-S K-1 box 17 code AC = Gross receipts for section 448(c)
 *   1065   K-1 box 14 code A  = Net earnings (loss) from self-employment
 *   1065   K-1 box 19 code A  = Cash and marketable securities
 *   1065   K-1 box 20 code Z  = Section 199A information
 *
 * Only Copy B ("For Recipient", printed in black) of Form 1099-NEC is emitted.
 * The IRS notice on that PDF states Copy A is informational, is not scannable
 * when self-printed, and must not be filed; Copy B is the copy the IRS tells
 * issuers to download and print.
 *
 * The downloaded PDFs are treated strictly as binary form templates. Nothing
 * fetched here is fed to an LLM as instructions.
 *
 * ---------------------------------------------------------------------------
 * THE PREPARED BOOKS
 * ---------------------------------------------------------------------------
 * `figures.json` is the ledger; every PDF in the pack renders values taken from
 * the same in-memory objects that produce it. `assertBooksTie()` re-derives every
 * cross-document relationship and throws if one breaks, so a bad edit fails the
 * run instead of shipping an incoherent pack.
 *
 * Northgate Millwork, Inc. (hero, Form 1120-S, TY2025) works end to end:
 *   trial balance (debits = credits = 6,623,350)
 *     -> profit & loss (4,286,400 - 3,680,000 = 606,400)
 *     -> balance sheet (2,130,350 = 682,550 + 1,447,800)
 *     -> fixed asset schedule (2025 depreciation 138,600 = the P&L line)
 *     -> Form 1120-S lines 1a-21 (see FORM_1120S_LINES)
 *     -> two Schedule K-1s (394,160 + 212,240 = 606,400)
 *   Subcontracted labor 296,400 equals the three 1099-NECs issued.
 *
 * THE ONE PLANTED DISCREPANCY: the four Forms 941 report 1,218,500 of wages,
 * exactly 18,500 more than the P&L's salaries_wages + officer_compensation of
 * 1,200,000. The story a reviewer would land on is 2%-shareholder health
 * insurance included in W-2 box 1 but booked to employee benefits. Nothing else
 * in the pack disagrees with anything else.
 *
 * Alder Creek Design Studio LLC (spare, Form 1065, TY2025) is fully consistent:
 * the two prior-year (2024) K-1s close at 203,200 + 135,500 = 338,700 of partner
 * capital, which rolls forward 338,700 + 255,600 - 220,000 = 374,300, the
 * members' equity on the 12/31/2025 balance sheet.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  TextAlignment,
  rgb,
} from "pdf-lib";
import type { PDFForm } from "pdf-lib";

const OUT_DIR = "demo-docs";
const BLANKS_DIR = join(tmpdir(), "tax-docs-irs-blanks");

/** Fixed so regeneration is byte-identical; also the date the pack is "as of". */
const PACK_DATE = new Date("2026-02-02T00:00:00Z");
const PRODUCER = "tax-docs demo document generator";

const IRS_BLANKS = {
  f941: "https://www.irs.gov/pub/irs-prior/f941--2025.pdf",
  f1099nec: "https://www.irs.gov/pub/irs-prior/f1099nec--2025.pdf",
  f1120ssk: "https://www.irs.gov/pub/irs-pdf/f1120ssk.pdf",
  f1065sk1_2024: "https://www.irs.gov/pub/irs-prior/f1065sk1--2024.pdf",
} as const;

type BlankForm = keyof typeof IRS_BLANKS;

// ---------------------------------------------------------------------------
// The prepared returns
// ---------------------------------------------------------------------------

const HERO = {
  name: "Northgate Millwork, Inc.",
  ein: "88-3104927",
  entityType: "S corporation",
  filingType: "1120-S",
  taxYear: 2025,
  street: "4120 NE Columbia Blvd, Suite 200",
  city: "Portland",
  state: "OR",
  zip: "97218",
  phone: "503-555-0147",
  totalShares: 10_000,
} as const;

const HERO_ADDRESS_LINES = [HERO.street, `${HERO.city}, ${HERO.state} ${HERO.zip}`];

/** Profit & loss for the year ended 12/31/2025. Foots to net income exactly. */
const HERO_PL = {
  grossReceipts: 4_286_400,
  expenses: [
    { label: "Materials and supplies", amount: 1_412_300 },
    { label: "Subcontracted labor", amount: 296_400 },
    { label: "Salaries and wages", amount: 936_000 },
    { label: "Officer compensation", amount: 264_000 },
    { label: "Employee benefits", amount: 86_400 },
    { label: "Taxes and licenses (including payroll taxes)", amount: 118_060 },
    { label: "Rent", amount: 172_800 },
    { label: "Depreciation", amount: 138_600 },
    { label: "Advertising", amount: 41_250 },
    { label: "Insurance", amount: 38_900 },
    { label: "Professional fees", amount: 33_500 },
    { label: "Repairs and maintenance", amount: 27_400 },
    { label: "Utilities", amount: 31_700 },
    { label: "Vehicle and delivery", amount: 36_200 },
    { label: "Office and administrative", amount: 24_650 },
    { label: "Interest expense", amount: 21_840 },
  ],
} as const;

const HERO_PL_TOTAL_EXPENSES = sum(HERO_PL.expenses.map((e) => e.amount));
const HERO_PL_NET_INCOME = HERO_PL.grossReceipts - HERO_PL_TOTAL_EXPENSES;
const HERO_PL_PAYROLL = pick(HERO_PL, "Salaries and wages") + pick(HERO_PL, "Officer compensation");

const HERO_BS = {
  cash: 428_750,
  accountsReceivable: 612_400,
  inventory: 284_300,
  prepaidExpenses: 38_900,
  propertyAtCost: 1_144_600,
  accumulatedDepreciation: 393_000,
  securityDeposits: 14_400,
  accountsPayable: 236_800,
  accruedPayroll: 87_450,
  accruedExpenses: 41_300,
  notePayableCurrent: 62_400,
  notePayableLongTerm: 254_600,
  commonStock: 10_000,
  additionalPaidInCapital: 140_000,
  retainedEarnings: 1_297_800,
} as const;

const HERO_BS_CURRENT_ASSETS =
  HERO_BS.cash + HERO_BS.accountsReceivable + HERO_BS.inventory + HERO_BS.prepaidExpenses;
const HERO_BS_PROPERTY_NET = HERO_BS.propertyAtCost - HERO_BS.accumulatedDepreciation;
const HERO_BS_TOTAL_ASSETS =
  HERO_BS_CURRENT_ASSETS + HERO_BS_PROPERTY_NET + HERO_BS.securityDeposits;
const HERO_BS_CURRENT_LIABILITIES =
  HERO_BS.accountsPayable +
  HERO_BS.accruedPayroll +
  HERO_BS.accruedExpenses +
  HERO_BS.notePayableCurrent;
const HERO_BS_TOTAL_LIABILITIES = HERO_BS_CURRENT_LIABILITIES + HERO_BS.notePayableLongTerm;
const HERO_BS_TOTAL_EQUITY =
  HERO_BS.commonStock + HERO_BS.additionalPaidInCapital + HERO_BS.retainedEarnings;

const HERO_DISTRIBUTIONS = 420_000;
const HERO_BEGINNING_RETAINED_EARNINGS =
  HERO_BS.retainedEarnings - HERO_PL_NET_INCOME + HERO_DISTRIBUTIONS;

/** Adjusted, pre-closing trial balance at 12/31/2025. */
const HERO_TRIAL_BALANCE: { account: string; description: string; debit: number; credit: number }[] =
  [
    ["1000", "Cash and cash equivalents", HERO_BS.cash, 0],
    ["1100", "Accounts receivable — trade", HERO_BS.accountsReceivable, 0],
    ["1300", "Inventory — materials and work in process", HERO_BS.inventory, 0],
    ["1400", "Prepaid expenses", HERO_BS.prepaidExpenses, 0],
    ["1500", "Leasehold improvements", 186_000, 0],
    ["1510", "Machinery and equipment", 584_000, 0],
    ["1520", "Vehicles", 128_000, 0],
    ["1530", "Shop equipment and tooling", 96_600, 0],
    ["1540", "Office furniture and computers", 62_000, 0],
    ["1550", "Finishing booth", 88_000, 0],
    ["1600", "Accumulated depreciation", 0, HERO_BS.accumulatedDepreciation],
    ["1700", "Security deposits", HERO_BS.securityDeposits, 0],
    ["2000", "Accounts payable — trade", 0, HERO_BS.accountsPayable],
    ["2100", "Accrued payroll and payroll taxes", 0, HERO_BS.accruedPayroll],
    ["2150", "Accrued expenses", 0, HERO_BS.accruedExpenses],
    ["2200", "Note payable — current portion", 0, HERO_BS.notePayableCurrent],
    ["2300", "Note payable — long-term portion", 0, HERO_BS.notePayableLongTerm],
    ["3000", "Common stock", 0, HERO_BS.commonStock],
    ["3100", "Additional paid-in capital", 0, HERO_BS.additionalPaidInCapital],
    ["3150", "Retained earnings, beginning of year", 0, HERO_BEGINNING_RETAINED_EARNINGS],
    ["3200", "Shareholder distributions", HERO_DISTRIBUTIONS, 0],
    ["4000", "Gross receipts or sales", 0, HERO_PL.grossReceipts],
    ["5000", "Materials and supplies", 1_412_300, 0],
    ["5100", "Subcontracted labor", 296_400, 0],
    ["6000", "Salaries and wages", 936_000, 0],
    ["6100", "Officer compensation", 264_000, 0],
    ["6200", "Employee benefits", 86_400, 0],
    ["6300", "Payroll taxes", 99_120, 0],
    ["6310", "Taxes and licenses", 18_940, 0],
    ["6400", "Rent", 172_800, 0],
    ["6500", "Depreciation", 138_600, 0],
    ["6600", "Advertising", 41_250, 0],
    ["6700", "Insurance", 38_900, 0],
    ["6800", "Professional fees", 33_500, 0],
    ["6900", "Repairs and maintenance", 27_400, 0],
    ["7000", "Utilities", 31_700, 0],
    ["7100", "Vehicle and delivery", 36_200, 0],
    ["7200", "Office and administrative", 24_650, 0],
    ["7300", "Interest expense", 21_840, 0],
  ].map(([account, description, debit, credit]) => ({
    account: account as string,
    description: description as string,
    debit: debit as number,
    credit: credit as number,
  }));

const HERO_TB_DEBITS = sum(HERO_TRIAL_BALANCE.map((r) => r.debit));
const HERO_TB_CREDITS = sum(HERO_TRIAL_BALANCE.map((r) => r.credit));

/** Book (straight-line) fixed asset schedule. Current-year column foots to the P&L. */
const HERO_FIXED_ASSETS = [
  { asset: "Leasehold improvements — shop buildout", inService: "01/04/2021", life: 15, cost: 186_000 },
  { asset: "CNC router and controls", inService: "01/11/2022", life: 10, cost: 342_000 },
  { asset: "Panel saw and edgebander", inService: "01/09/2023", life: 7, cost: 168_000 },
  { asset: "Dust collection system", inService: "01/16/2023", life: 10, cost: 74_000 },
  { asset: "Delivery trucks (2)", inService: "01/22/2024", life: 5, cost: 128_000 },
  { asset: "Shop equipment and tooling", inService: "01/06/2024", life: 7, cost: 96_600 },
  { asset: "Office furniture and computers", inService: "01/13/2025", life: 5, cost: 62_000 },
  { asset: "Finishing booth upgrade", inService: "01/20/2025", life: 10, cost: 88_000 },
].map((a) => {
  const annual = a.cost / a.life;
  const priorYears = 2025 - Number(a.inService.slice(-4));
  const priorAccumulated = annual * priorYears;
  return {
    ...a,
    annual,
    priorAccumulated,
    accumulated: priorAccumulated + annual,
    netBookValue: a.cost - priorAccumulated - annual,
  };
});

const HERO_FA_COST = sum(HERO_FIXED_ASSETS.map((a) => a.cost));
const HERO_FA_CURRENT_DEPRECIATION = sum(HERO_FIXED_ASSETS.map((a) => a.annual));
const HERO_FA_ACCUMULATED = sum(HERO_FIXED_ASSETS.map((a) => a.accumulated));

/**
 * Monthly gross W-2 wages as filed on the Forms 941. These total 18,500 MORE
 * than the P&L payroll accounts — the single planted cross-document discrepancy.
 */
const HERO_PAYROLL_MONTHS = [
  { quarter: 1, month: "January", wages: 94_200 },
  { quarter: 1, month: "February", wages: 96_800 },
  { quarter: 1, month: "March", wages: 101_400 },
  { quarter: 2, month: "April", wages: 99_700 },
  { quarter: 2, month: "May", wages: 102_300 },
  { quarter: 2, month: "June", wages: 103_600 },
  { quarter: 3, month: "July", wages: 100_500 },
  { quarter: 3, month: "August", wages: 99_800 },
  { quarter: 3, month: "September", wages: 98_600 },
  { quarter: 4, month: "October", wages: 104_300 },
  { quarter: 4, month: "November", wages: 106_200 },
  { quarter: 4, month: "December", wages: 111_100 },
] as const;

const WITHHOLDING_RATE = 0.115;
const SOCIAL_SECURITY_RATE = 0.124; // Form 941 line 5a, employee + employer
const MEDICARE_RATE = 0.029; // Form 941 line 5c, employee + employer

/** Headcount reported on line 1 for the pay period including the 12th. */
const HERO_QUARTER_EMPLOYEES = [22, 23, 23, 24] as const;

const HERO_QUARTERS = [1, 2, 3, 4].map((q) => {
  const months = HERO_PAYROLL_MONTHS.filter((m) => m.quarter === q).map((m) => {
    const withheld = round2(m.wages * WITHHOLDING_RATE);
    const fica = round2(m.wages * (SOCIAL_SECURITY_RATE + MEDICARE_RATE));
    return { month: m.month, wages: m.wages, withheld, liability: round2(withheld + fica) };
  });
  const wages = sum(months.map((m) => m.wages));
  const withheld = round2(sum(months.map((m) => m.withheld)));
  const socialSecurity = round2(wages * SOCIAL_SECURITY_RATE);
  const medicare = round2(wages * MEDICARE_RATE);
  const ficaTotal = round2(socialSecurity + medicare);
  return {
    quarter: q,
    label: `Q${q}` as const,
    employees: HERO_QUARTER_EMPLOYEES[q - 1] as number,
    months,
    wages,
    withheld,
    socialSecurity,
    medicare,
    ficaTotal,
    totalTax: round2(withheld + ficaTotal),
  };
});

const HERO_941_WAGES = sum(HERO_QUARTERS.map((q) => q.wages));
const PLANTED_DISCREPANCY = HERO_941_WAGES - HERO_PL_PAYROLL;

const HERO_CONTRACTORS = [
  {
    slug: "halvorsen",
    name: "Halvorsen Finish Carpentry LLC",
    tin: "93-2846015",
    street: "2255 SE Ochoco St",
    cityStateZip: "Milwaukie, OR 97222",
    compensation: 132_850,
  },
  {
    slug: "delgado",
    name: "Ramon Delgado Installation Services",
    tin: "541-88-2073",
    street: "914 N Watts St",
    cityStateZip: "Portland, OR 97217",
    compensation: 104_600,
  },
  {
    slug: "sightline",
    name: "Sightline CAD Drafting LLC",
    tin: "87-4419266",
    street: "1180 SW Cascade Ave, Suite 4",
    cityStateZip: "Beaverton, OR 97005",
    compensation: 58_950,
  },
] as const;

const HERO_SHAREHOLDERS = [
  {
    slug: "hale",
    name: "Marcus T. Hale",
    tin: "542-19-7736",
    street: "3418 NE Klickitat St",
    cityStateZip: "Portland, OR 97212",
    percent: 65,
    shares: 6_500,
    title: "President",
  },
  {
    slug: "raman",
    name: "Priya N. Raman",
    tin: "531-64-2085",
    street: "705 SW Gaines St, Apt 1204",
    cityStateZip: "Portland, OR 97239",
    percent: 35,
    shares: 3_500,
    title: "Secretary",
  },
].map((s) => ({
  ...s,
  ordinaryIncome: round2((HERO_PL_NET_INCOME * s.percent) / 100),
  distributions: round2((HERO_DISTRIBUTIONS * s.percent) / 100),
  grossReceiptsShare: round2((HERO_PL.grossReceipts * s.percent) / 100),
}));

/**
 * Form 1120-S page 1. Not emitted as a PDF — the pack ships the source documents
 * a client hands over, not the return — but the K-1s flow from line 21, so the
 * lines are worked here and asserted against the books.
 */
const FORM_1120S_LINES = {
  "1a Gross receipts or sales": HERO_PL.grossReceipts,
  "1b Returns and allowances": 0,
  "1c Balance": HERO_PL.grossReceipts,
  "2 Cost of goods sold": 0,
  "3 Gross profit": HERO_PL.grossReceipts,
  "6 Total income": HERO_PL.grossReceipts,
  "7 Compensation of officers": pick(HERO_PL, "Officer compensation"),
  "8 Salaries and wages": pick(HERO_PL, "Salaries and wages"),
  "9 Repairs and maintenance": pick(HERO_PL, "Repairs and maintenance"),
  "11 Rents": pick(HERO_PL, "Rent"),
  "12 Taxes and licenses": pick(HERO_PL, "Taxes and licenses (including payroll taxes)"),
  "13 Interest": pick(HERO_PL, "Interest expense"),
  "14 Depreciation": pick(HERO_PL, "Depreciation"),
  "16 Advertising": pick(HERO_PL, "Advertising"),
  "18 Employee benefit programs": pick(HERO_PL, "Employee benefits"),
  "19 Other deductions":
    pick(HERO_PL, "Materials and supplies") +
    pick(HERO_PL, "Subcontracted labor") +
    pick(HERO_PL, "Insurance") +
    pick(HERO_PL, "Professional fees") +
    pick(HERO_PL, "Utilities") +
    pick(HERO_PL, "Vehicle and delivery") +
    pick(HERO_PL, "Office and administrative"),
  "20 Total deductions": HERO_PL_TOTAL_EXPENSES,
  "21 Ordinary business income (loss)": HERO_PL_NET_INCOME,
} as const;

/** Oregon apportions business income on a single sales factor (ORS 314.650). */
const APPORTIONMENT = {
  states: ["Oregon", "Washington", "Idaho"] as const,
  rows: [
    { factor: "Property (at original cost)", values: [1_030_140, 114_460, 0], everywhere: HERO_FA_COST },
    { factor: "Payroll (employee compensation)", values: [1_044_000, 96_000, 60_000], everywhere: HERO_PL_PAYROLL },
    { factor: "Sales (gross receipts)", values: [3_214_800, 686_200, 385_400], everywhere: HERO_PL.grossReceipts },
  ],
};

const OREGON_SALES_FACTOR = 0.75;
const OREGON_APPORTIONED_INCOME = round2(HERO_PL_NET_INCOME * OREGON_SALES_FACTOR);

const LEASE = {
  landlord: "Columbia Industrial Holdings, LLC",
  premises: "4120 NE Columbia Blvd, Suite 200, Portland, Oregon 97218",
  rentableSqFt: 18_400,
  commencement: "March 1, 2023",
  expiration: "February 28, 2028",
  monthlyBaseRent: pick(HERO_PL, "Rent") / 12,
  securityDeposit: HERO_BS.securityDeposits,
} as const;

// --- Spare company ---------------------------------------------------------

const SPARE = {
  name: "Alder Creek Design Studio LLC",
  ein: "92-7551408",
  entityType: "Limited liability company",
  filingType: "1065",
  taxYear: 2025,
  street: "815 SW Bond Street, Suite 3",
  city: "Bend",
  state: "OR",
  zip: "97702",
} as const;

const SPARE_ADDRESS_LINES = [SPARE.street, `${SPARE.city}, ${SPARE.state} ${SPARE.zip}`];

const SPARE_PL = {
  grossReceipts: 1_342_800,
  expenses: [
    { label: "Guaranteed payments to partners", amount: 168_000 },
    { label: "Salaries and wages", amount: 486_000 },
    { label: "Employee benefits", amount: 38_400 },
    { label: "Taxes and licenses (including payroll taxes)", amount: 44_880 },
    { label: "Contract labor", amount: 92_300 },
    { label: "Project reimbursable costs", amount: 62_180 },
    { label: "Rent", amount: 66_000 },
    { label: "Depreciation", amount: 18_400 },
    { label: "Advertising", amount: 12_750 },
    { label: "Insurance", amount: 14_900 },
    { label: "Professional fees", amount: 16_200 },
    { label: "Software and subscriptions", amount: 22_400 },
    { label: "Travel and client development", amount: 19_850 },
    { label: "Office and administrative", amount: 15_300 },
    { label: "Utilities", amount: 9_640 },
  ],
} as const;

const SPARE_PL_TOTAL_EXPENSES = sum(SPARE_PL.expenses.map((e) => e.amount));
const SPARE_PL_NET_INCOME = SPARE_PL.grossReceipts - SPARE_PL_TOTAL_EXPENSES;

const SPARE_BS = {
  cash: 186_450,
  accountsReceivable: 214_800,
  unbilledFees: 62_300,
  prepaidExpenses: 11_700,
  propertyAtCost: 148_600,
  accumulatedDepreciation: 73_900,
  securityDeposit: 8_800,
  accountsPayable: 68_400,
  accruedPayroll: 31_250,
  deferredRevenue: 54_600,
  lineOfCredit: 30_200,
} as const;

const SPARE_BS_CURRENT_ASSETS =
  SPARE_BS.cash + SPARE_BS.accountsReceivable + SPARE_BS.unbilledFees + SPARE_BS.prepaidExpenses;
const SPARE_BS_PROPERTY_NET = SPARE_BS.propertyAtCost - SPARE_BS.accumulatedDepreciation;
const SPARE_BS_TOTAL_ASSETS =
  SPARE_BS_CURRENT_ASSETS + SPARE_BS_PROPERTY_NET + SPARE_BS.securityDeposit;
const SPARE_BS_TOTAL_LIABILITIES =
  SPARE_BS.accountsPayable +
  SPARE_BS.accruedPayroll +
  SPARE_BS.deferredRevenue +
  SPARE_BS.lineOfCredit;
const SPARE_BS_TOTAL_EQUITY = SPARE_BS_TOTAL_ASSETS - SPARE_BS_TOTAL_LIABILITIES;

const SPARE_2025_DISTRIBUTIONS = 220_000;

/** Prior-year (2024) partner K-1s. Ending capital rolls into the 2025 balance sheet. */
const SPARE_PARTNERS = [
  {
    slug: "vasquez",
    name: "Elena M. Vasquez",
    tin: "528-73-1194",
    street: "1622 NW Milwaukee Ave",
    cityStateZip: "Bend, OR 97703",
    percent: 60,
    beginningCapital: 186_400,
    distributions2024: 144_000,
    recourseBeginning: 55_800,
    recourseEnding: 49_200,
    guaranteedPayments2024: 90_000,
  },
  {
    slug: "okafor",
    name: "Daniel R. Okafor",
    tin: "536-40-8827",
    street: "60945 Granite Dr",
    cityStateZip: "Bend, OR 97702",
    percent: 40,
    beginningCapital: 124_300,
    distributions2024: 96_000,
    recourseBeginning: 37_200,
    recourseEnding: 32_800,
    guaranteedPayments2024: 72_000,
  },
] as const;

const SPARE_2024_ORDINARY_INCOME = 268_000;

const SPARE_K1S = SPARE_PARTNERS.map((p) => {
  const ordinaryIncome = round2((SPARE_2024_ORDINARY_INCOME * p.percent) / 100);
  return {
    ...p,
    ordinaryIncome,
    endingCapital: p.beginningCapital + ordinaryIncome - p.distributions2024,
    selfEmployment: round2(ordinaryIncome + p.guaranteedPayments2024),
  };
});

const SPARE_2024_ENDING_CAPITAL = sum(SPARE_K1S.map((p) => p.endingCapital));

// ---------------------------------------------------------------------------
// Ledger — every PDF renders values read back out of this object
// ---------------------------------------------------------------------------

type FieldValue = string | number | boolean;

interface FigureDocument {
  file: string;
  documentTypeId: string | null;
  fields: Record<string, FieldValue>;
}

interface FigureCompany {
  name: string;
  ein: string;
  entityType: string;
  filingType: string;
  taxYear: number;
  documents: FigureDocument[];
}

function buildFigures(): { companies: FigureCompany[] } {
  const heroDocs: FigureDocument[] = [
    {
      file: `${OUT_DIR}/northgate-profit-and-loss-2025.pdf`,
      documentTypeId: "dt-profit-loss",
      fields: {
        business_name: HERO.name,
        period_start: "2025-01-01",
        period_end: "2025-12-31",
        gross_receipts: HERO_PL.grossReceipts,
        total_expenses: HERO_PL_TOTAL_EXPENSES,
        net_income: HERO_PL_NET_INCOME,
        officer_compensation: pick(HERO_PL, "Officer compensation"),
        salaries_wages: pick(HERO_PL, "Salaries and wages"),
        rents: pick(HERO_PL, "Rent"),
        taxes_licenses: pick(HERO_PL, "Taxes and licenses (including payroll taxes)"),
        depreciation: pick(HERO_PL, "Depreciation"),
        advertising: pick(HERO_PL, "Advertising"),
      },
    },
    {
      file: `${OUT_DIR}/northgate-balance-sheet-2025.pdf`,
      documentTypeId: "dt-balance-sheet",
      fields: {
        business_name: HERO.name,
        period_end: "2025-12-31",
        total_assets: HERO_BS_TOTAL_ASSETS,
        total_liabilities: HERO_BS_TOTAL_LIABILITIES,
        total_equity: HERO_BS_TOTAL_EQUITY,
        cash: HERO_BS.cash,
        accounts_receivable: HERO_BS.accountsReceivable,
      },
    },
    {
      file: `${OUT_DIR}/northgate-trial-balance-2025.pdf`,
      documentTypeId: "dt-trial-balance",
      fields: {
        business_name: HERO.name,
        period_end: "2025-12-31",
        total_debits: HERO_TB_DEBITS,
        total_credits: HERO_TB_CREDITS,
      },
    },
    {
      file: `${OUT_DIR}/northgate-fixed-asset-schedule-2025.pdf`,
      documentTypeId: "dt-fixed-assets",
      fields: {
        business_name: HERO.name,
        period_end: "2025-12-31",
        total_cost_basis: HERO_FA_COST,
        total_accumulated_depreciation: HERO_FA_ACCUMULATED,
        current_year_depreciation: HERO_FA_CURRENT_DEPRECIATION,
      },
    },
    ...HERO_QUARTERS.map((q) => ({
      file: `${OUT_DIR}/northgate-form-941-2025-q${q.quarter}.pdf`,
      documentTypeId: "dt-941",
      fields: {
        business_name: HERO.name,
        employer_ein: HERO.ein,
        quarter: q.label,
        tax_year: HERO.taxYear,
        wages_tips_compensation: q.wages,
        federal_tax_withheld: q.withheld,
      },
    })),
    ...HERO_CONTRACTORS.map((c) => ({
      file: `${OUT_DIR}/northgate-1099-nec-2025-${c.slug}.pdf`,
      documentTypeId: "dt-1099-nec",
      fields: {
        payer_name: HERO.name,
        payer_tin: HERO.ein,
        recipient_name: c.name,
        recipient_tin: c.tin,
        nonemployee_compensation: c.compensation,
        tax_year: HERO.taxYear,
      },
    })),
    ...HERO_SHAREHOLDERS.map((s) => ({
      file: `${OUT_DIR}/northgate-k1-1120s-2025-${s.slug}.pdf`,
      documentTypeId: "dt-k1-1120s",
      fields: {
        corporation_name: HERO.name,
        corporation_ein: HERO.ein,
        shareholder_name: s.name,
        ordinary_business_income: s.ordinaryIncome,
        tax_year: HERO.taxYear,
      },
    })),
    // Bait 1: relevant to the client but carries no tax figures — quality review rejects it.
    { file: `${OUT_DIR}/lease-agreement.pdf`, documentTypeId: null, fields: {} },
    // Bait 2: a real tax working paper whose type is not in the registry — fail-soft path.
    { file: `${OUT_DIR}/state-apportionment-schedule.pdf`, documentTypeId: null, fields: {} },
  ];

  const spareDocs: FigureDocument[] = [
    {
      file: `${OUT_DIR}/alder-creek-profit-and-loss-2025.pdf`,
      documentTypeId: "dt-profit-loss",
      fields: {
        business_name: SPARE.name,
        period_start: "2025-01-01",
        period_end: "2025-12-31",
        gross_receipts: SPARE_PL.grossReceipts,
        total_expenses: SPARE_PL_TOTAL_EXPENSES,
        net_income: SPARE_PL_NET_INCOME,
        salaries_wages: pick(SPARE_PL, "Salaries and wages"),
        rents: pick(SPARE_PL, "Rent"),
        taxes_licenses: pick(SPARE_PL, "Taxes and licenses (including payroll taxes)"),
        depreciation: pick(SPARE_PL, "Depreciation"),
        advertising: pick(SPARE_PL, "Advertising"),
      },
    },
    {
      file: `${OUT_DIR}/alder-creek-balance-sheet-2025.pdf`,
      documentTypeId: "dt-balance-sheet",
      fields: {
        business_name: SPARE.name,
        period_end: "2025-12-31",
        total_assets: SPARE_BS_TOTAL_ASSETS,
        total_liabilities: SPARE_BS_TOTAL_LIABILITIES,
        total_equity: SPARE_BS_TOTAL_EQUITY,
        cash: SPARE_BS.cash,
        accounts_receivable: SPARE_BS.accountsReceivable,
      },
    },
    ...SPARE_K1S.map((p) => ({
      file: `${OUT_DIR}/alder-creek-k1-1065-2024-${p.slug}.pdf`,
      documentTypeId: "dt-k1-1065",
      fields: {
        partnership_name: SPARE.name,
        partnership_ein: SPARE.ein,
        partner_name: p.name,
        ordinary_business_income: p.ordinaryIncome,
        tax_year: 2024,
      },
    })),
  ];

  return {
    companies: [
      {
        name: HERO.name,
        ein: HERO.ein,
        entityType: HERO.entityType,
        filingType: HERO.filingType,
        taxYear: HERO.taxYear,
        documents: heroDocs,
      },
      {
        name: SPARE.name,
        ein: SPARE.ein,
        entityType: SPARE.entityType,
        filingType: SPARE.filingType,
        taxYear: SPARE.taxYear,
        documents: spareDocs,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Self-verification — the pack refuses to generate if the books stop tying
// ---------------------------------------------------------------------------

function assertBooksTie(): void {
  const checks: [string, boolean, string][] = [
    [
      "trial balance debits equal credits",
      HERO_TB_DEBITS === HERO_TB_CREDITS,
      `${HERO_TB_DEBITS} vs ${HERO_TB_CREDITS}`,
    ],
    [
      "trial balance expense accounts foot to the P&L",
      sum(
        HERO_TRIAL_BALANCE.filter((r) => r.account >= "5000" && r.debit > 0).map((r) => r.debit),
      ) === HERO_PL_TOTAL_EXPENSES,
      `${HERO_PL_TOTAL_EXPENSES}`,
    ],
    [
      "balance sheet balances",
      HERO_BS_TOTAL_ASSETS === HERO_BS_TOTAL_LIABILITIES + HERO_BS_TOTAL_EQUITY,
      `${HERO_BS_TOTAL_ASSETS} vs ${HERO_BS_TOTAL_LIABILITIES + HERO_BS_TOTAL_EQUITY}`,
    ],
    [
      "P&L foots",
      HERO_PL_NET_INCOME === HERO_PL.grossReceipts - HERO_PL_TOTAL_EXPENSES,
      `${HERO_PL_NET_INCOME}`,
    ],
    [
      "fixed asset current-year depreciation equals the P&L depreciation",
      HERO_FA_CURRENT_DEPRECIATION === pick(HERO_PL, "Depreciation"),
      `${HERO_FA_CURRENT_DEPRECIATION}`,
    ],
    [
      "fixed asset cost equals property on the balance sheet",
      HERO_FA_COST === HERO_BS.propertyAtCost,
      `${HERO_FA_COST} vs ${HERO_BS.propertyAtCost}`,
    ],
    [
      "fixed asset accumulated depreciation equals the balance sheet",
      HERO_FA_ACCUMULATED === HERO_BS.accumulatedDepreciation,
      `${HERO_FA_ACCUMULATED} vs ${HERO_BS.accumulatedDepreciation}`,
    ],
    [
      "1099-NEC total equals subcontracted labor",
      sum(HERO_CONTRACTORS.map((c) => c.compensation)) === pick(HERO_PL, "Subcontracted labor"),
      `${sum(HERO_CONTRACTORS.map((c) => c.compensation))}`,
    ],
    [
      "1120-S line 20 equals total deductions",
      FORM_1120S_LINES["20 Total deductions"] === HERO_PL_TOTAL_EXPENSES,
      `${FORM_1120S_LINES["20 Total deductions"]}`,
    ],
    [
      "K-1 ordinary income sums to 1120-S line 21",
      sum(HERO_SHAREHOLDERS.map((s) => s.ordinaryIncome)) ===
        FORM_1120S_LINES["21 Ordinary business income (loss)"],
      `${sum(HERO_SHAREHOLDERS.map((s) => s.ordinaryIncome))}`,
    ],
    [
      "K-1 distributions sum to the trial balance distributions",
      sum(HERO_SHAREHOLDERS.map((s) => s.distributions)) === HERO_DISTRIBUTIONS,
      `${sum(HERO_SHAREHOLDERS.map((s) => s.distributions))}`,
    ],
    [
      "941 quarterly liabilities equal the sum of their monthly liabilities",
      HERO_QUARTERS.every(
        (q) => round2(sum(q.months.map((m) => m.liability))) === q.totalTax,
      ),
      "monthly deposit schedule",
    ],
    [
      "apportionment factors foot to the books",
      APPORTIONMENT.rows.every((r) => sum(r.values) === r.everywhere),
      "property / payroll / sales",
    ],
    [
      "Oregon sales factor is the stated percentage",
      round2(APPORTIONMENT.rows[2]!.values[0]! / APPORTIONMENT.rows[2]!.everywhere) ===
        OREGON_SALES_FACTOR,
      `${OREGON_SALES_FACTOR}`,
    ],
    [
      "lease base rent annualizes to the P&L rent",
      LEASE.monthlyBaseRent * 12 === pick(HERO_PL, "Rent"),
      `${LEASE.monthlyBaseRent}`,
    ],
    ["spare P&L foots", SPARE_PL_NET_INCOME === 255_600, `${SPARE_PL_NET_INCOME}`],
    [
      "spare balance sheet balances",
      SPARE_BS_TOTAL_ASSETS === SPARE_BS_TOTAL_LIABILITIES + SPARE_BS_TOTAL_EQUITY,
      `${SPARE_BS_TOTAL_ASSETS}`,
    ],
    [
      "spare 2024 K-1 ending capital rolls forward into 2025 members' equity",
      SPARE_2024_ENDING_CAPITAL + SPARE_PL_NET_INCOME - SPARE_2025_DISTRIBUTIONS ===
        SPARE_BS_TOTAL_EQUITY,
      `${SPARE_2024_ENDING_CAPITAL} + ${SPARE_PL_NET_INCOME} - ${SPARE_2025_DISTRIBUTIONS} != ${SPARE_BS_TOTAL_EQUITY}`,
    ],
    [
      "spare K-1 ordinary income sums to 2024 ordinary income",
      sum(SPARE_K1S.map((p) => p.ordinaryIncome)) === SPARE_2024_ORDINARY_INCOME,
      `${sum(SPARE_K1S.map((p) => p.ordinaryIncome))}`,
    ],
    [
      "the planted payroll discrepancy is exactly 18,500",
      PLANTED_DISCREPANCY === 18_500,
      `${HERO_941_WAGES} - ${HERO_PL_PAYROLL} = ${PLANTED_DISCREPANCY}`,
    ],
  ];

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    throw new Error(
      `demo-docs books do not tie:\n${failed.map(([name, , detail]) => `  - ${name} (${detail})`).join("\n")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Numeric and string helpers
// ---------------------------------------------------------------------------

function sum(values: readonly number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pick(pl: { expenses: readonly { label: string; amount: number }[] }, label: string): number {
  const row = pl.expenses.find((e) => e.label === label);
  if (!row) throw new Error(`no P&L line named "${label}"`);
  return row.amount;
}

function groupDigits(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Whole dollars with thousands separators; negatives in accounting parentheses. */
function dollars(n: number): string {
  const rounded = Math.round(n);
  const text = groupDigits(String(Math.abs(rounded)));
  return rounded < 0 ? `(${text})` : text;
}

function dollarsAndCents(n: number): string {
  const [whole, cents] = splitCents(n);
  return `${whole}.${cents}`;
}

/** Splits an amount the way IRS forms want it: dollars box and cents box. */
function splitCents(n: number): [string, string] {
  const total = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(total / 100);
  const cents = total % 100;
  const sign = n < 0 ? "-" : "";
  return [`${sign}${groupDigits(String(whole))}`, String(cents).padStart(2, "0")];
}

function percent(n: number, places = 6): string {
  return n.toFixed(places);
}

// ---------------------------------------------------------------------------
// PDF plumbing
// ---------------------------------------------------------------------------

async function fetchBlank(form: BlankForm): Promise<Uint8Array> {
  const cached = join(BLANKS_DIR, `${form}.pdf`);
  if (existsSync(cached)) return new Uint8Array(await readFile(cached));

  const url = IRS_BLANKS[form];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await mkdir(BLANKS_DIR, { recursive: true });
  await writeFile(cached, bytes);
  console.log(`  downloaded ${url}`);
  return bytes;
}

function stampMetadata(pdf: PDFDocument, title: string): void {
  pdf.setTitle(title);
  pdf.setAuthor(PRODUCER);
  pdf.setProducer(PRODUCER);
  pdf.setCreator(PRODUCER);
  pdf.setSubject("Fictional demo document — not a real tax filing");
  pdf.setCreationDate(PACK_DATE);
  pdf.setModificationDate(PACK_DATE);
}

async function newDocument(title: string): Promise<PDFDocument> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  stampMetadata(pdf, title);
  return pdf;
}

async function save(pdf: PDFDocument, filename: string): Promise<void> {
  await writeFile(join(OUT_DIR, filename), await pdf.save());
}

/**
 * IRS AcroForm field names look like
 * `topmostSubform[0].Page1[0].Header[0].EntityArea[0].f1_1[0]`. Fields are
 * addressed here by the readable tail of that path (`EntityArea.f1_1`), and an
 * ambiguous or unknown path is an error rather than a silently skipped value.
 */
class FormFiller {
  private readonly paths = new Map<string, string>();

  constructor(private readonly form: PDFForm) {
    for (const field of form.getFields()) {
      const full = field.getName();
      this.paths.set(FormFiller.normalize(full), full);
    }
  }

  private static normalize(name: string): string {
    return name
      .replace(/^topmostSubform\[0\]\./, "")
      .replace(/\[0\]/g, "")
      .replace(/\[(\d+)\]/g, "#$1");
  }

  private resolve(path: string): string {
    const exact = this.paths.get(path);
    if (exact) return exact;
    const suffix = `.${path}`;
    const matches = [...this.paths.entries()].filter(([key]) => key.endsWith(suffix));
    if (matches.length === 1) return matches[0]![1];
    if (matches.length === 0) throw new Error(`no AcroForm field matching "${path}"`);
    throw new Error(
      `ambiguous AcroForm field "${path}": ${matches.map(([key]) => key).join(", ")}`,
    );
  }

  text(
    path: string,
    value: string,
    opts: { size?: number; align?: TextAlignment; multiline?: boolean } = {},
  ): void {
    const field = this.form.getTextField(this.resolve(path));
    const max = field.getMaxLength();
    if (max !== undefined && value.length > max) {
      throw new Error(`value "${value}" exceeds maxLength ${max} on field "${path}"`);
    }
    if (opts.multiline) field.enableMultiline();
    field.setFontSize(opts.size ?? 9);
    if (opts.align) field.setAlignment(opts.align);
    field.setText(value);
  }

  /** Fills an IRS split dollars/cents money pair. */
  money(dollarsPath: string, centsPath: string, amount: number, size = 9): void {
    const [whole, cents] = splitCents(amount);
    this.text(dollarsPath, whole, { size, align: TextAlignment.Right });
    this.text(centsPath, cents, { size, align: TextAlignment.Right });
  }

  check(path: string): void {
    this.form.getCheckBox(this.resolve(path)).check();
  }
}

/** Fills the blank, flattens it, and lifts the given pages into a fresh document. */
async function fillIrsForm(
  blank: BlankForm,
  title: string,
  pages: number[],
  fill: (filler: FormFiller) => void,
): Promise<PDFDocument> {
  const source = await PDFDocument.load(await fetchBlank(blank), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const form = source.getForm();
  fill(new FormFiller(form));
  form.flatten();

  const out = await newDocument(title);
  for (const page of await out.copyPages(source, pages)) out.addPage(page);
  return out;
}

// ---------------------------------------------------------------------------
// Drawn document primitives
// ---------------------------------------------------------------------------

const INK = rgb(0.18, 0.18, 0.15);
const HAIRLINE = rgb(0.62, 0.62, 0.58);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

async function embedFonts(pdf: PDFDocument): Promise<Fonts> {
  return {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  page.drawText(text, { x, y, font, size, color: INK });
}

function drawRight(
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  drawText(page, text, right - font.widthOfTextAtSize(text, size), y, font, size);
}

function drawCentered(
  page: PDFPage,
  text: string,
  center: number,
  y: number,
  font: PDFFont,
  size: number,
): void {
  drawText(page, text, center - font.widthOfTextAtSize(text, size) / 2, y, font, size);
}

function drawRule(page: PDFPage, x: number, y: number, width: number, thickness = 0.5): void {
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    thickness,
    color: HAIRLINE,
  });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Centered company letterhead + statement title block. Returns the next baseline. */
function drawLetterhead(
  page: PDFPage,
  fonts: Fonts,
  opts: { company: string; addressLines: string[]; title: string; period: string; note?: string },
): number {
  const { width, height } = page.getSize();
  const center = width / 2;
  let y = height - 62;

  drawCentered(page, opts.company, center, y, fonts.bold, 15);
  y -= 15;
  for (const line of opts.addressLines) {
    drawCentered(page, line, center, y, fonts.regular, 8.5);
    y -= 11;
  }
  y -= 8;
  drawCentered(page, opts.title, center, y, fonts.bold, 11.5);
  y -= 14;
  drawCentered(page, opts.period, center, y, fonts.regular, 9.5);
  y -= 12;
  if (opts.note) {
    drawCentered(page, opts.note, center, y, fonts.italic, 8);
    y -= 12;
  }
  y -= 6;
  return y;
}

function drawFooter(page: PDFPage, fonts: Fonts, margin: number, text: string): void {
  drawText(page, text, margin, 44, fonts.italic, 7.5);
}

type StatementRow =
  | { kind: "section"; label: string }
  | { kind: "item"; label: string; amount: number; indent?: number }
  | { kind: "subtotal"; label: string; amount: number; indent?: number }
  | { kind: "total"; label: string; amount: number }
  | { kind: "gap"; height?: number };

function drawStatementRows(
  page: PDFPage,
  fonts: Fonts,
  startY: number,
  margin: number,
  rows: StatementRow[],
): number {
  const { width } = page.getSize();
  const right = width - margin;
  const size = 9.5;
  let y = startY;

  for (const row of rows) {
    switch (row.kind) {
      case "gap":
        y -= row.height ?? 10;
        break;
      case "section":
        y -= 6;
        drawText(page, row.label.toUpperCase(), margin, y, fonts.bold, 9);
        y -= 15;
        break;
      case "item":
        drawText(page, row.label, margin + 12 * (row.indent ?? 1), y, fonts.regular, size);
        drawRight(page, dollars(row.amount), right, y, fonts.regular, size);
        y -= 14;
        break;
      case "subtotal":
        drawRule(page, right - 96, y + 10, 96);
        drawText(page, row.label, margin + 12 * (row.indent ?? 1), y, fonts.regular, size);
        drawRight(page, `$ ${dollars(row.amount)}`, right, y, fonts.regular, size);
        y -= 16;
        break;
      case "total":
        drawRule(page, right - 108, y + 11, 108);
        drawText(page, row.label, margin, y, fonts.bold, size);
        drawRight(page, `$ ${dollars(row.amount)}`, right, y, fonts.bold, size);
        drawRule(page, right - 108, y - 4, 108);
        drawRule(page, right - 108, y - 6.5, 108);
        y -= 18;
        break;
    }
  }
  return y;
}

interface Column {
  header: string;
  width: number;
  align: "left" | "right";
}

function drawTable(
  page: PDFPage,
  fonts: Fonts,
  startY: number,
  x: number,
  columns: Column[],
  rows: (string[] | "rule")[],
  size = 8.5,
): number {
  const totalWidth = columns.reduce((a, c) => a + c.width, 0);
  let y = startY;

  const headerLines = columns.map((c) => wrapText(c.header, fonts.bold, size, c.width - 8));
  const headerDepth = Math.max(...headerLines.map((l) => l.length));
  for (let line = 0; line < headerDepth; line += 1) {
    let cx = x;
    columns.forEach((col, i) => {
      const text = headerLines[i]![line - (headerDepth - headerLines[i]!.length)];
      if (text) {
        if (col.align === "right") drawRight(page, text, cx + col.width - 4, y, fonts.bold, size);
        else drawText(page, text, cx + 4, y, fonts.bold, size);
      }
      cx += col.width;
    });
    y -= 11;
  }
  drawRule(page, x, y + 6, totalWidth, 0.8);
  y -= 6;

  for (const row of rows) {
    if (row === "rule") {
      drawRule(page, x, y + 9, totalWidth);
      y -= 4;
      continue;
    }
    let cx = x;
    columns.forEach((col, i) => {
      const text = row[i] ?? "";
      if (fonts.regular.widthOfTextAtSize(text, size) > col.width - 8) {
        throw new Error(`"${text}" does not fit the ${col.width}pt "${col.header}" column`);
      }
      if (col.align === "right") drawRight(page, text, cx + col.width - 4, y, fonts.regular, size);
      else drawText(page, text, cx + 4, y, fonts.regular, size);
      cx += col.width;
    });
    y -= 12.5;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

const MARGIN = 56;
const STATEMENT_FOOTER =
  "Fictional demo document generated for the tax-docs prototype. Not a real entity and not a real tax filing.";

async function buildProfitAndLoss(
  company: { name: string; addressLines: string[] },
  pl: { grossReceipts: number; expenses: readonly { label: string; amount: number }[] },
  totalExpenses: number,
  netIncome: number,
): Promise<PDFDocument> {
  const pdf = await newDocument(`${company.name} — Profit and Loss Statement`);
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage([612, 792]);

  const y = drawLetterhead(page, fonts, {
    company: company.name,
    addressLines: company.addressLines,
    title: "Profit and Loss Statement",
    period: "For the Period January 1, 2025 through December 31, 2025",
    note: "All amounts in U.S. dollars. Accrual basis.",
  });

  drawStatementRows(page, fonts, y, MARGIN, [
    { kind: "section", label: "Revenue" },
    { kind: "item", label: "Gross receipts or sales", amount: pl.grossReceipts },
    { kind: "subtotal", label: "Total revenue", amount: pl.grossReceipts },
    { kind: "section", label: "Operating expenses" },
    ...pl.expenses.map((e) => ({ kind: "item" as const, label: e.label, amount: e.amount })),
    { kind: "subtotal", label: "Total expenses", amount: totalExpenses },
    { kind: "gap", height: 6 },
    { kind: "total", label: "NET INCOME", amount: netIncome },
  ]);

  drawFooter(page, fonts, MARGIN, STATEMENT_FOOTER);
  return pdf;
}

async function buildHeroBalanceSheet(): Promise<PDFDocument> {
  const pdf = await newDocument(`${HERO.name} — Balance Sheet`);
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage([612, 792]);

  const y = drawLetterhead(page, fonts, {
    company: HERO.name,
    addressLines: HERO_ADDRESS_LINES,
    title: "Balance Sheet",
    period: "As of December 31, 2025",
    note: "All amounts in U.S. dollars. Accrual basis.",
  });

  drawStatementRows(page, fonts, y, MARGIN, [
    { kind: "section", label: "Assets" },
    { kind: "item", label: "Cash and cash equivalents", amount: HERO_BS.cash },
    { kind: "item", label: "Accounts receivable, net", amount: HERO_BS.accountsReceivable },
    { kind: "item", label: "Inventory — materials and work in process", amount: HERO_BS.inventory },
    { kind: "item", label: "Prepaid expenses", amount: HERO_BS.prepaidExpenses },
    { kind: "subtotal", label: "Total current assets", amount: HERO_BS_CURRENT_ASSETS },
    { kind: "gap", height: 4 },
    { kind: "item", label: "Property and equipment, at cost", amount: HERO_BS.propertyAtCost },
    {
      kind: "item",
      label: "Less: accumulated depreciation",
      amount: -HERO_BS.accumulatedDepreciation,
    },
    { kind: "subtotal", label: "Property and equipment, net", amount: HERO_BS_PROPERTY_NET },
    { kind: "gap", height: 4 },
    { kind: "item", label: "Security deposits", amount: HERO_BS.securityDeposits },
    { kind: "total", label: "TOTAL ASSETS", amount: HERO_BS_TOTAL_ASSETS },
    { kind: "section", label: "Liabilities and stockholders' equity" },
    { kind: "item", label: "Accounts payable", amount: HERO_BS.accountsPayable },
    { kind: "item", label: "Accrued payroll and payroll taxes", amount: HERO_BS.accruedPayroll },
    { kind: "item", label: "Accrued expenses", amount: HERO_BS.accruedExpenses },
    { kind: "item", label: "Current portion of note payable", amount: HERO_BS.notePayableCurrent },
    { kind: "subtotal", label: "Total current liabilities", amount: HERO_BS_CURRENT_LIABILITIES },
    { kind: "gap", height: 4 },
    {
      kind: "item",
      label: "Note payable, net of current portion",
      amount: HERO_BS.notePayableLongTerm,
    },
    { kind: "subtotal", label: "Total liabilities", amount: HERO_BS_TOTAL_LIABILITIES },
    { kind: "gap", height: 6 },
    { kind: "item", label: "Common stock", amount: HERO_BS.commonStock },
    { kind: "item", label: "Additional paid-in capital", amount: HERO_BS.additionalPaidInCapital },
    { kind: "item", label: "Retained earnings", amount: HERO_BS.retainedEarnings },
    { kind: "subtotal", label: "Total stockholders' equity", amount: HERO_BS_TOTAL_EQUITY },
    {
      kind: "total",
      label: "TOTAL LIABILITIES AND STOCKHOLDERS' EQUITY",
      amount: HERO_BS_TOTAL_LIABILITIES + HERO_BS_TOTAL_EQUITY,
    },
  ]);

  drawFooter(page, fonts, MARGIN, STATEMENT_FOOTER);
  return pdf;
}

async function buildSpareBalanceSheet(): Promise<PDFDocument> {
  const pdf = await newDocument(`${SPARE.name} — Balance Sheet`);
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage([612, 792]);

  const y = drawLetterhead(page, fonts, {
    company: SPARE.name,
    addressLines: SPARE_ADDRESS_LINES,
    title: "Balance Sheet",
    period: "As of December 31, 2025",
    note: "All amounts in U.S. dollars. Accrual basis.",
  });

  drawStatementRows(page, fonts, y, MARGIN, [
    { kind: "section", label: "Assets" },
    { kind: "item", label: "Cash", amount: SPARE_BS.cash },
    { kind: "item", label: "Accounts receivable, net", amount: SPARE_BS.accountsReceivable },
    { kind: "item", label: "Unbilled fees (work in process)", amount: SPARE_BS.unbilledFees },
    { kind: "item", label: "Prepaid expenses", amount: SPARE_BS.prepaidExpenses },
    { kind: "subtotal", label: "Total current assets", amount: SPARE_BS_CURRENT_ASSETS },
    { kind: "gap", height: 4 },
    {
      kind: "item",
      label: "Furniture, fixtures and equipment, at cost",
      amount: SPARE_BS.propertyAtCost,
    },
    {
      kind: "item",
      label: "Less: accumulated depreciation",
      amount: -SPARE_BS.accumulatedDepreciation,
    },
    {
      kind: "subtotal",
      label: "Furniture, fixtures and equipment, net",
      amount: SPARE_BS_PROPERTY_NET,
    },
    { kind: "gap", height: 4 },
    { kind: "item", label: "Security deposit", amount: SPARE_BS.securityDeposit },
    { kind: "total", label: "TOTAL ASSETS", amount: SPARE_BS_TOTAL_ASSETS },
    { kind: "section", label: "Liabilities and members' equity" },
    { kind: "item", label: "Accounts payable", amount: SPARE_BS.accountsPayable },
    { kind: "item", label: "Accrued payroll and payroll taxes", amount: SPARE_BS.accruedPayroll },
    { kind: "item", label: "Deferred revenue — client retainers", amount: SPARE_BS.deferredRevenue },
    { kind: "item", label: "Line of credit", amount: SPARE_BS.lineOfCredit },
    { kind: "subtotal", label: "Total liabilities", amount: SPARE_BS_TOTAL_LIABILITIES },
    { kind: "gap", height: 6 },
    { kind: "item", label: "Members' capital", amount: SPARE_BS_TOTAL_EQUITY },
    { kind: "subtotal", label: "Total members' equity", amount: SPARE_BS_TOTAL_EQUITY },
    {
      kind: "total",
      label: "TOTAL LIABILITIES AND MEMBERS' EQUITY",
      amount: SPARE_BS_TOTAL_LIABILITIES + SPARE_BS_TOTAL_EQUITY,
    },
  ]);

  drawFooter(page, fonts, MARGIN, STATEMENT_FOOTER);
  return pdf;
}

async function buildTrialBalance(): Promise<PDFDocument> {
  const pdf = await newDocument(`${HERO.name} — Trial Balance`);
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage([612, 792]);

  const y = drawLetterhead(page, fonts, {
    company: HERO.name,
    addressLines: HERO_ADDRESS_LINES,
    title: "Adjusted Trial Balance",
    period: "As of December 31, 2025",
    note: "All amounts in U.S. dollars. Pre-closing.",
  });

  const columns: Column[] = [
    { header: "Account", width: 54, align: "left" },
    { header: "Description", width: 246, align: "left" },
    { header: "Debit", width: 100, align: "right" },
    { header: "Credit", width: 100, align: "right" },
  ];

  const rows: (string[] | "rule")[] = HERO_TRIAL_BALANCE.map((r) => [
    r.account,
    r.description,
    r.debit ? dollars(r.debit) : "",
    r.credit ? dollars(r.credit) : "",
  ]);
  rows.push("rule");
  rows.push(["", "Totals", dollars(HERO_TB_DEBITS), dollars(HERO_TB_CREDITS)]);

  const endY = drawTable(page, fonts, y - 4, MARGIN, columns, rows);
  drawRule(page, MARGIN, endY + 9, 500);
  drawRule(page, MARGIN, endY + 6.5, 500);

  drawFooter(page, fonts, MARGIN, STATEMENT_FOOTER);
  return pdf;
}

async function buildFixedAssetSchedule(): Promise<PDFDocument> {
  const pdf = await newDocument(`${HERO.name} — Fixed Asset Schedule`);
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage([792, 612]);

  const y = drawLetterhead(page, fonts, {
    company: HERO.name,
    addressLines: HERO_ADDRESS_LINES,
    title: "Fixed Asset and Depreciation Schedule",
    period: "As of December 31, 2025",
    note: "Book basis, straight-line. All amounts in U.S. dollars.",
  });

  const columns: Column[] = [
    { header: "Asset description", width: 200, align: "left" },
    { header: "Date in service", width: 62, align: "left" },
    { header: "Method", width: 42, align: "left" },
    { header: "Life (yrs)", width: 32, align: "right" },
    { header: "Cost basis", width: 76, align: "right" },
    { header: "Accum. depr. 12/31/2024", width: 80, align: "right" },
    { header: "2025 depreciation", width: 76, align: "right" },
    { header: "Accum. depr. 12/31/2025", width: 80, align: "right" },
    { header: "Net book value", width: 48, align: "right" },
  ];

  const rows: (string[] | "rule")[] = HERO_FIXED_ASSETS.map((a) => [
    a.asset,
    a.inService,
    "SL",
    String(a.life),
    dollars(a.cost),
    dollars(a.priorAccumulated),
    dollars(a.annual),
    dollars(a.accumulated),
    dollars(a.netBookValue),
  ]);
  rows.push("rule");
  rows.push([
    "Totals",
    "",
    "",
    "",
    dollars(HERO_FA_COST),
    dollars(sum(HERO_FIXED_ASSETS.map((a) => a.priorAccumulated))),
    dollars(HERO_FA_CURRENT_DEPRECIATION),
    dollars(HERO_FA_ACCUMULATED),
    dollars(HERO_FA_COST - HERO_FA_ACCUMULATED),
  ]);

  const tableWidth = columns.reduce((a, c) => a + c.width, 0);
  const endY = drawTable(page, fonts, y - 4, 48, columns, rows);
  drawRule(page, 48, endY + 9, tableWidth);
  drawRule(page, 48, endY + 6.5, tableWidth);

  drawText(
    page,
    `Current-year depreciation of ${dollars(HERO_FA_CURRENT_DEPRECIATION)} agrees to the depreciation expense reported on the profit and loss statement.`,
    48,
    endY - 14,
    fonts.regular,
    8.5,
  );

  drawFooter(page, fonts, 48, STATEMENT_FOOTER);
  return pdf;
}

// ---------------------------------------------------------------------------
// IRS forms
// ---------------------------------------------------------------------------

async function buildForm941(quarter: (typeof HERO_QUARTERS)[number]): Promise<PDFDocument> {
  const [einPrefix, einRest] = HERO.ein.split("-") as [string, string];

  return fillIrsForm(
    "f941",
    `${HERO.name} — Form 941 Q${quarter.quarter} 2025`,
    [0, 1],
    (f) => {
      // Page 1 — entity area
      f.text("Page1.Header.EntityArea.f1_1", einPrefix, { size: 10 });
      f.text("Page1.Header.EntityArea.f1_2", einRest, { size: 10 });
      f.text("Page1.Header.EntityArea.f1_3", HERO.name);
      f.text("Page1.Header.EntityArea.f1_5", HERO.street);
      f.text("Page1.Header.EntityArea.f1_6", HERO.city);
      f.text("Page1.Header.EntityArea.f1_7", HERO.state);
      f.text("Page1.Header.EntityArea.f1_8", HERO.zip);
      f.check(`Page1.Header.ReportForQuarter.c1_1${quarter.quarter === 1 ? "" : `#${quarter.quarter - 1}`}`);

      // Page 1, Part 1
      f.text("Page1.f1_12", String(quarter.employees), { align: TextAlignment.Right });
      f.money("Page1.f1_13", "Page1.f1_14", quarter.wages); // line 2
      f.money("Page1.f1_15", "Page1.f1_16", quarter.withheld); // line 3
      f.money("Page1.f1_17", "Page1.f1_18", quarter.wages); // line 5a column 1
      f.money("Page1.f1_19", "Page1.f1_20", quarter.socialSecurity); // line 5a column 2
      f.money("Page1.f1_25", "Page1.f1_26", quarter.wages); // line 5c column 1
      f.money("Page1.f1_27", "Page1.f1_28", quarter.medicare); // line 5c column 2
      f.money("Page1.f1_33", "Page1.f1_34", quarter.ficaTotal); // line 5e
      f.money("Page1.f1_37", "Page1.f1_38", quarter.totalTax); // line 6
      f.money("Page1.f1_45", "Page1.f1_46", quarter.totalTax); // line 10
      f.money("Page1.f1_49", "Page1.f1_50", quarter.totalTax); // line 12
      f.money("Page1.f1_51", "Page1.f1_52", quarter.totalTax); // line 13 — deposits
      f.money("Page1.f1_53", "Page1.f1_54", 0); // line 14 — balance due

      // Page 2 — deposit schedule and signature
      f.text("Page2.Name_ReadOrder.f1_3", HERO.name);
      f.text("Page2.EIN_Number.f1_1", einPrefix, { size: 10 });
      f.text("Page2.EIN_Number.f1_2", einRest, { size: 10 });
      f.check("Page2.c2_1#1"); // line 16 — monthly schedule depositor
      const [m1, m2, m3] = quarter.months as [
        (typeof quarter.months)[number],
        (typeof quarter.months)[number],
        (typeof quarter.months)[number],
      ];
      f.money("Page2.f2_1", "Page2.f2_2", m1.liability);
      f.money("Page2.f2_3", "Page2.f2_4", m2.liability);
      f.money("Page2.f2_5", "Page2.f2_6", m3.liability);
      f.money("Page2.f2_7", "Page2.f2_8", quarter.totalTax);
      f.check("Page2.c2_4#1"); // Part 4 — no third-party designee
      f.text("Page2.f2_13", HERO_SHAREHOLDERS[0]!.name);
      f.text("Page2.f2_14", HERO_SHAREHOLDERS[0]!.title);
      f.text("Page2.f2_15", HERO.phone);
    },
  );
}

async function build1099Nec(
  contractor: (typeof HERO_CONTRACTORS)[number],
): Promise<PDFDocument> {
  return fillIrsForm(
    "f1099nec",
    `${HERO.name} — Form 1099-NEC 2025 (${contractor.name})`,
    [3], // Copy B — For Recipient
    (f) => {
      f.text("CopyB.PgHeader.CalendarYear.f2_1", "2025", { size: 9 });
      f.text(
        "CopyB.LeftCol.f2_2",
        [HERO.name, ...HERO_ADDRESS_LINES, HERO.phone].join("\n"),
        { size: 8, multiline: true },
      );
      f.text("CopyB.LeftCol.f2_3", HERO.ein);
      f.text("CopyB.LeftCol.f2_4", contractor.tin);
      f.text("CopyB.LeftCol.f2_5", contractor.name, { size: 8.5 });
      f.text("CopyB.LeftCol.f2_6", contractor.street, { size: 8.5 });
      f.text("CopyB.LeftCol.f2_7", contractor.cityStateZip, { size: 8.5 });
      f.text("CopyB.RightCol.f2_9", dollarsAndCents(contractor.compensation), {
        align: TextAlignment.Right,
      }); // box 1
      f.text("CopyB.RightCol.f2_11", dollarsAndCents(0), { align: TextAlignment.Right }); // box 4
      f.text("CopyB.RightCol.Box6_ReadOrder.f2_14", "OR", { size: 8.5 }); // box 6
      f.text("CopyB.RightCol.Box7_ReadOrder.f2_16", dollarsAndCents(contractor.compensation), {
        align: TextAlignment.Right,
      }); // box 7
    },
  );
}

async function buildK1120s(
  shareholder: (typeof HERO_SHAREHOLDERS)[number],
): Promise<PDFDocument> {
  return fillIrsForm(
    "f1120ssk",
    `${HERO.name} — 2025 Schedule K-1 (Form 1120-S) (${shareholder.name})`,
    [0],
    (f) => {
      // Part I — information about the corporation
      f.text("LeftCol.f1_06", HERO.ein);
      f.text("LeftCol.f1_07", [HERO.name, ...HERO_ADDRESS_LINES].join("\n"), {
        size: 8.5,
        multiline: true,
      });
      f.text("LeftCol.f1_08", "Ogden, UT");
      f.text("LeftCol.f1_09", dollars(HERO.totalShares), { align: TextAlignment.Right });
      f.text("LeftCol.f1_10", dollars(HERO.totalShares), { align: TextAlignment.Right });

      // Part II — information about the shareholder
      f.text("LeftCol.f1_11", shareholder.tin);
      f.text(
        "LeftCol.f1_12",
        [shareholder.name, shareholder.street, shareholder.cityStateZip].join("\n"),
        { size: 8.5, multiline: true },
      );
      f.text("LeftCol.f1_16", percent(shareholder.percent), { align: TextAlignment.Right });
      f.text("LeftCol.f1_17", dollars(shareholder.shares), { align: TextAlignment.Right });
      f.text("LeftCol.f1_18", dollars(shareholder.shares), { align: TextAlignment.Right });

      // Part III — box 1, box 16 code D, box 17 code AC
      f.text("Lines1-12.f1_21", dollars(shareholder.ordinaryIncome), {
        align: TextAlignment.Right,
      });
      f.text("Lines13-17.f1_80", "D");
      f.text("Lines13-17.f1_81", dollars(shareholder.distributions), {
        align: TextAlignment.Right,
      });
      f.text("Lines13-17.f1_90", "AC");
      f.text("Lines13-17.f1_91", dollars(shareholder.grossReceiptsShare), {
        align: TextAlignment.Right,
      });
    },
  );
}

async function buildK1065(partner: (typeof SPARE_K1S)[number]): Promise<PDFDocument> {
  return fillIrsForm(
    "f1065sk1_2024",
    `${SPARE.name} — 2024 Schedule K-1 (Form 1065) (${partner.name})`,
    [0],
    (f) => {
      // Part I — information about the partnership
      f.text("LeftCol.f1_6", SPARE.ein);
      f.text("LeftCol.f1_7", [SPARE.name, ...SPARE_ADDRESS_LINES].join("\n"), {
        size: 8.5,
        multiline: true,
      });
      f.text("LeftCol.f1_8", "Ogden, UT");

      // Part II — information about the partner
      f.text("LeftCol.f1_9", partner.tin);
      f.text(
        "LeftCol.f1_10",
        [partner.name, partner.street, partner.cityStateZip].join("\n"),
        { size: 8.5, multiline: true },
      );
      f.check("LeftCol.c1_4"); // G — general partner / LLC member-manager
      f.check("LeftCol.c1_5"); // H1 — domestic partner
      f.text("LeftCol.f1_13", "Individual", { size: 8.5 }); // I1 — type of entity

      // J — share of profit, loss, and capital
      const share = percent(partner.percent, 4);
      f.text("Profit.f1_14", share, { align: TextAlignment.Right });
      f.text("Profit.f1_15", share, { align: TextAlignment.Right });
      f.text("Loss.f1_16", share, { align: TextAlignment.Right });
      f.text("Loss.f1_17", share, { align: TextAlignment.Right });
      f.text("Capital.f1_18", share, { align: TextAlignment.Right });
      f.text("Capital.f1_19", share, { align: TextAlignment.Right });

      // K1 — share of liabilities
      f.text("Recourse.f1_24", dollars(partner.recourseBeginning), {
        align: TextAlignment.Right,
      });
      f.text("Recourse.f1_25", dollars(partner.recourseEnding), { align: TextAlignment.Right });

      // L — capital account analysis
      f.text("Row1.f1_26", dollars(partner.beginningCapital), { align: TextAlignment.Right });
      f.text("Row3.f1_28", dollars(partner.ordinaryIncome), { align: TextAlignment.Right });
      f.text("Row5.f1_30", dollars(partner.distributions2024), { align: TextAlignment.Right });
      f.text("Row6.f1_31", dollars(partner.endingCapital), { align: TextAlignment.Right });
      f.check("LeftCol.c1_11#1"); // M — no property with built-in gain or loss contributed

      // Part III — boxes 1, 4a, 4c, 14A, 19A, 20Z
      f.text("RightCol1.f1_34", dollars(partner.ordinaryIncome), { align: TextAlignment.Right });
      f.text("RightCol1.f1_37", dollars(partner.guaranteedPayments2024), {
        align: TextAlignment.Right,
      });
      f.text("RightCol1.f1_39", dollars(partner.guaranteedPayments2024), {
        align: TextAlignment.Right,
      });
      f.text("RightCol2.Line14", "A");
      f.text("RightCol2.f1_60", dollars(partner.selfEmployment), { align: TextAlignment.Right });
      f.text("RightCol2.Line19", "A");
      f.text("RightCol2.f1_89", dollars(partner.distributions2024), {
        align: TextAlignment.Right,
      });
      f.text("RightCol2.Line20", "Z");
      f.text("RightCol2.f1_92", "STMT", { align: TextAlignment.Right });
    },
  );
}

// ---------------------------------------------------------------------------
// Bait documents
// ---------------------------------------------------------------------------

/** Bait 1: a real lease, zero tax figures — the quality-review rejection. */
async function buildLeaseAgreement(): Promise<PDFDocument> {
  const pdf = await newDocument("Commercial Lease Agreement");
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage([612, 792]);
  const { width } = page.getSize();
  const contentWidth = width - MARGIN * 2;

  let y = 792 - 64;
  drawCentered(page, "COMMERCIAL LEASE AGREEMENT", width / 2, y, fonts.bold, 13);
  y -= 16;
  drawCentered(page, "(Single Tenant — Industrial / Flex)", width / 2, y, fonts.regular, 9);
  y -= 22;
  drawRule(page, MARGIN, y, contentWidth, 0.8);
  y -= 22;

  const clauses: [string, string][] = [
    [
      "1. Parties",
      `This Commercial Lease Agreement (the "Lease") is made and entered into as of February 14, 2023, by and between ${LEASE.landlord}, an Oregon limited liability company ("Landlord"), and ${HERO.name}, an Oregon corporation ("Tenant").`,
    ],
    [
      "2. Premises",
      `Landlord leases to Tenant, and Tenant leases from Landlord, the premises commonly known as ${LEASE.premises}, containing approximately ${groupDigits(String(LEASE.rentableSqFt))} rentable square feet of manufacturing, warehouse, and office space (the "Premises"), together with the non-exclusive right to use the common areas of the property.`,
    ],
    [
      "3. Term",
      `The term of this Lease shall be sixty (60) months, commencing on ${LEASE.commencement} (the "Commencement Date") and expiring on ${LEASE.expiration}, unless sooner terminated or extended in accordance with the terms of this Lease. Tenant shall have one (1) option to extend the term for an additional sixty (60) months upon not less than one hundred eighty (180) days' prior written notice to Landlord.`,
    ],
    [
      "4. Base Rent",
      `Tenant shall pay to Landlord base rent of $${dollars(LEASE.monthlyBaseRent)} per month, payable in advance on the first day of each calendar month without demand, deduction, or offset. Base rent shall be subject to an annual adjustment of three percent (3%) on each anniversary of the Commencement Date.`,
    ],
    [
      "5. Additional Rent",
      "This Lease is a triple net lease. In addition to base rent, Tenant shall pay its proportionate share of real property taxes, insurance premiums, and common area maintenance charges, estimated monthly and reconciled annually within ninety (90) days after the end of each calendar year.",
    ],
    [
      "6. Security Deposit",
      `Concurrently with the execution of this Lease, Tenant has deposited with Landlord the sum of $${dollars(LEASE.securityDeposit)} as a security deposit for the faithful performance of Tenant's obligations. The deposit shall be returned to Tenant, less any lawful deductions, within thirty (30) days after expiration of the term.`,
    ],
    [
      "7. Use",
      "The Premises shall be used solely for architectural millwork fabrication, finishing, warehousing, and related general office purposes, and for no other use without Landlord's prior written consent, which shall not be unreasonably withheld.",
    ],
    [
      "8. Maintenance and Repairs",
      "Tenant shall, at its sole cost, maintain the interior of the Premises, including all dust collection, electrical distribution, and compressed air systems installed by Tenant, in good order and repair. Landlord shall maintain the roof, foundation, and structural elements of the building.",
    ],
    [
      "9. Insurance",
      "Tenant shall maintain commercial general liability insurance with limits of not less than $2,000,000 per occurrence, together with property insurance covering Tenant's trade fixtures, equipment, and inventory at full replacement cost. Landlord shall be named as an additional insured.",
    ],
    [
      "10. Governing Law",
      "This Lease shall be governed by and construed in accordance with the laws of the State of Oregon, without regard to its conflict of laws principles. Venue for any action arising under this Lease shall lie in Multnomah County, Oregon.",
    ],
  ];

  for (const [heading, body] of clauses) {
    drawText(page, heading, MARGIN, y, fonts.bold, 9);
    y -= 11.5;
    for (const line of wrapText(body, fonts.regular, 8.6, contentWidth)) {
      drawText(page, line, MARGIN, y, fonts.regular, 8.6);
      y -= 10.5;
    }
    y -= 5;
  }

  drawText(
    page,
    "IN WITNESS WHEREOF, the parties have executed this Lease as of the date first written above.",
    MARGIN,
    y,
    fonts.regular,
    8.6,
  );
  y -= 24;

  const columnWidth = contentWidth / 2 - 12;
  const signatories: [string, string, number][] = [
    ["LANDLORD:", LEASE.landlord, MARGIN],
    ["TENANT:", HERO.name, MARGIN + columnWidth + 24],
  ];
  for (const [role, party, x] of signatories) {
    drawText(page, role, x, y, fonts.bold, 8.5);
    drawText(page, party, x, y - 11, fonts.regular, 8.6);
    drawRule(page, x, y - 30, columnWidth);
    drawText(page, "Authorized signature", x, y - 39, fonts.regular, 7.5);
    drawRule(page, x, y - 58, columnWidth);
    drawText(page, "Printed name and title", x, y - 67, fonts.regular, 7.5);
  }

  const lowestBaseline = y - 67;
  if (lowestBaseline < 58) {
    throw new Error(`lease signature block overruns the footer (baseline ${lowestBaseline})`);
  }

  drawFooter(
    page,
    fonts,
    MARGIN,
    "Fictional demo document generated for the tax-docs prototype. Not a real lease and not legal advice.",
  );
  return pdf;
}

/** Bait 2: a genuine tax working paper of a type the registry does not define. */
async function buildApportionmentSchedule(): Promise<PDFDocument> {
  const pdf = await newDocument(`${HERO.name} — State Apportionment Schedule`);
  const fonts = await embedFonts(pdf);
  const page = pdf.addPage([612, 792]);
  const margin = 46;

  let y = drawLetterhead(page, fonts, {
    company: HERO.name,
    addressLines: [`EIN ${HERO.ein}`, ...HERO_ADDRESS_LINES],
    title: "Multistate Apportionment Schedule",
    period: "Tax Year Ended December 31, 2025",
    note: "All amounts in U.S. dollars. Prepared for state income and excise tax filings.",
  });

  const columns: Column[] = [
    { header: "Apportionment factor", width: 148, align: "left" },
    { header: "Oregon", width: 76, align: "right" },
    { header: "Washington", width: 76, align: "right" },
    { header: "Idaho", width: 64, align: "right" },
    { header: "Everywhere", width: 84, align: "right" },
    { header: "Oregon factor %", width: 72, align: "right" },
  ];

  const rows: (string[] | "rule")[] = APPORTIONMENT.rows.map((r) => [
    r.factor,
    dollars(r.values[0]!),
    dollars(r.values[1]!),
    dollars(r.values[2]!),
    dollars(r.everywhere),
    percent((r.values[0]! / r.everywhere) * 100, 4),
  ]);

  y = drawTable(page, fonts, y - 4, margin, columns, rows);
  y -= 16;

  drawText(page, "OREGON APPORTIONMENT AND TAX BASE", margin, y, fonts.bold, 9);
  y -= 16;

  const summaryColumns: Column[] = [
    { header: "Line", width: 34, align: "left" },
    { header: "Description", width: 372, align: "left" },
    { header: "Amount", width: 114, align: "right" },
  ];

  const summaryRows: (string[] | "rule")[] = [
    ["1", "Apportionment method (ORS 314.650 — single sales factor)", "Sales only"],
    ["2", "Oregon sales factor (line 3 of the schedule above)", `${percent(OREGON_SALES_FACTOR * 100, 4)} %`],
    ["3", "Federal ordinary business income (Form 1120-S, line 21)", dollars(HERO_PL_NET_INCOME)],
    ["4", "Oregon additions", "0"],
    ["5", "Oregon subtractions", "0"],
    ["6", "Income subject to apportionment (line 3 plus line 4 less line 5)", dollars(HERO_PL_NET_INCOME)],
    "rule",
    ["7", "Oregon apportioned income (line 6 × line 2)", dollars(OREGON_APPORTIONED_INCOME)],
  ];

  y = drawTable(page, fonts, y, margin, summaryColumns, summaryRows);
  const summaryWidth = summaryColumns.reduce((a, c) => a + c.width, 0);
  drawRule(page, margin, y + 9, summaryWidth);
  drawRule(page, margin, y + 6.5, summaryWidth);
  y -= 22;

  drawText(page, "NOTES", margin, y, fonts.bold, 9);
  y -= 13;
  const notes = [
    "Property factor is stated at original cost of real and tangible personal property owned and used during the year, per the fixed asset and depreciation schedule.",
    "Payroll factor is total compensation paid to employees, agreeing to salaries and wages plus officer compensation on the profit and loss statement.",
    "Sales factor is gross receipts assigned to the state of delivery. Oregon apportions business income on the sales factor alone; the property and payroll factors are computed for reference and for states that require a three-factor formula.",
    "Washington imposes a business and occupation tax on gross receipts rather than a net income tax; the Washington column is presented for gross receipts reporting only.",
  ];
  for (const note of notes) {
    for (const line of wrapText(`•  ${note}`, fonts.regular, 8.2, summaryWidth - 6)) {
      drawText(page, line, margin, y, fonts.regular, 8.2);
      y -= 10.5;
    }
    y -= 3;
  }

  drawFooter(page, fonts, margin, STATEMENT_FOOTER);
  return pdf;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

function buildReadme(figures: { companies: FigureCompany[] }): string {
  const inventory = figures.companies
    .flatMap((c) =>
      c.documents.map(
        (d) =>
          `| \`${d.file.replace(`${OUT_DIR}/`, "")}\` | ${c.name} | ${d.documentTypeId ?? "_(none — intentional)_"} |`,
      ),
    )
    .join("\n");

  return `# demo-docs

Tracked demo document pack. Generated by \`bun run demo-docs\`
(\`scripts/generate-demo-docs.ts\`) — edit the script, never these files.

\`figures.json\` is the ledger: every figure printed in every PDF comes from it,
and the seed reads the same file so seeded extraction values match the documents
exactly. Regeneration is byte-for-byte idempotent.

Two fictional companies, both tax year 2025:

- **${HERO.name}** (EIN ${HERO.ein}) — S corporation, Form 1120-S. The hero
  engagement. Books worked end to end: trial balance → profit and loss → balance
  sheet → fixed asset schedule → four quarterly Forms 941 → Forms 1099-NEC →
  Form 1120-S lines 1a–21 → two Schedule K-1s.
- **${SPARE.name}** (EIN ${SPARE.ein}) — two-partner LLC, Form 1065. A smaller,
  fully consistent set for live "create a new engagement" moments.

## The one planted discrepancy

The four Forms 941 report ${dollars(HERO_941_WAGES)} of wages, exactly ${dollars(PLANTED_DISCREPANCY)}
more than the ${dollars(HERO_PL_PAYROLL)} of salaries and wages plus officer
compensation on the profit and loss statement.
It is the only inconsistency in the pack and exists to make the \`payroll-tie\`
validation check warn. A reviewer would land on 2%-shareholder health insurance
included in W-2 box 1 but booked to employee benefits.

## Deliberate bait

- \`lease-agreement.pdf\` — a real commercial lease with no tax figures on it.
  Exercises the quality-review rejection path.
- \`state-apportionment-schedule.pdf\` — a genuine tax working paper whose
  document type is not in the seeded registry. Exercises the fail-soft
  \`unclassified\` → AI-drafted-schema path.

Both carry \`documentTypeId: null\` in \`figures.json\`.

## Inventory

| File | Company | Document type |
|---|---|---|
${inventory}

## Sources

Blank forms are the tax-year 2025 revisions pulled from irs.gov at generation
time and cached outside the repo. Source URLs, revision dates, and the IRS
instruction pages used to confirm K-1 box codes are recorded in the header
comment of \`scripts/generate-demo-docs.ts\`.

Every entity, EIN, TIN, address, and dollar amount is fictional.
`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  assertBooksTie();
  await mkdir(OUT_DIR, { recursive: true });

  const figures = buildFigures();
  await writeFile(join(OUT_DIR, "figures.json"), `${JSON.stringify(figures, null, 2)}\n`);
  console.log(`wrote ${OUT_DIR}/figures.json`);

  const documents: [string, () => Promise<PDFDocument>][] = [
    [
      "northgate-profit-and-loss-2025.pdf",
      () =>
        buildProfitAndLoss(
          { name: HERO.name, addressLines: HERO_ADDRESS_LINES },
          HERO_PL,
          HERO_PL_TOTAL_EXPENSES,
          HERO_PL_NET_INCOME,
        ),
    ],
    ["northgate-balance-sheet-2025.pdf", buildHeroBalanceSheet],
    ["northgate-trial-balance-2025.pdf", buildTrialBalance],
    ["northgate-fixed-asset-schedule-2025.pdf", buildFixedAssetSchedule],
    ...HERO_QUARTERS.map(
      (q) =>
        [`northgate-form-941-2025-q${q.quarter}.pdf`, () => buildForm941(q)] as [
          string,
          () => Promise<PDFDocument>,
        ],
    ),
    ...HERO_CONTRACTORS.map(
      (c) =>
        [`northgate-1099-nec-2025-${c.slug}.pdf`, () => build1099Nec(c)] as [
          string,
          () => Promise<PDFDocument>,
        ],
    ),
    ...HERO_SHAREHOLDERS.map(
      (s) =>
        [`northgate-k1-1120s-2025-${s.slug}.pdf`, () => buildK1120s(s)] as [
          string,
          () => Promise<PDFDocument>,
        ],
    ),
    ["lease-agreement.pdf", buildLeaseAgreement],
    ["state-apportionment-schedule.pdf", buildApportionmentSchedule],
    [
      "alder-creek-profit-and-loss-2025.pdf",
      () =>
        buildProfitAndLoss(
          { name: SPARE.name, addressLines: SPARE_ADDRESS_LINES },
          SPARE_PL,
          SPARE_PL_TOTAL_EXPENSES,
          SPARE_PL_NET_INCOME,
        ),
    ],
    ["alder-creek-balance-sheet-2025.pdf", buildSpareBalanceSheet],
    ...SPARE_K1S.map(
      (p) =>
        [`alder-creek-k1-1065-2024-${p.slug}.pdf`, () => buildK1065(p)] as [
          string,
          () => Promise<PDFDocument>,
        ],
    ),
  ];

  for (const [filename, build] of documents) {
    await save(await build(), filename);
    console.log(`wrote ${OUT_DIR}/${filename}`);
  }

  await writeFile(join(OUT_DIR, "README.md"), buildReadme(figures));
  console.log(`wrote ${OUT_DIR}/README.md`);

  const expected = new Set(
    figures.companies.flatMap((c) => c.documents.map((d) => d.file.replace(`${OUT_DIR}/`, ""))),
  );
  const produced = new Set(documents.map(([filename]) => filename));
  const missing = [...expected].filter((f) => !produced.has(f));
  const extra = [...produced].filter((f) => !expected.has(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `figures.json and the generated files disagree — missing: [${missing.join(", ")}], extra: [${extra.join(", ")}]`,
    );
  }

  console.log(
    `\n${documents.length} documents + figures.json. Planted payroll discrepancy: ${dollars(PLANTED_DISCREPANCY)} (941 wages ${dollars(HERO_941_WAGES)} vs P&L payroll ${dollars(HERO_PL_PAYROLL)}).`,
  );
}

await main();
