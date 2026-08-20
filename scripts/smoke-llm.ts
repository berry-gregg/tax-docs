/**
 * Manual live-LLM smoke. Boots the real app + OpenRouter client, uploads the
 * Northgate P&L, the lease, and the apportionment schedule through the real
 * pipeline, and asserts the three bait outcomes.
 *
 * Not in the bun test gate. Run with `bun run smoke`.
 * OPENROUTER_API_KEY is read only through `src/server/config.ts` (Bun loads
 * `.env.local` automatically).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { createOpenRouterClient } from "../src/server/ai/openrouter.ts";
import { createApp } from "../src/server/app.ts";
import { config } from "../src/server/config.ts";
import { connectDb, disconnectDb } from "../src/server/db/client.ts";
import { createRunner } from "../src/server/pipeline/runner.ts";
import { seedIfEmpty } from "../src/server/seed/seed.ts";
import { POLL_INTERVAL_MS } from "../src/shared/constants.ts";
import { engagementListResponseSchema } from "../src/shared/schemas/api.ts";
import { taxDocumentSchema, type TaxDocument } from "../src/shared/schemas/document.ts";

const DEMO_DIR = join(import.meta.dir, "..", "demo-docs");
const HERO_CLIENT_NAME = "Northgate Millwork, Inc.";
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

const TERMINAL_STATUSES = new Set<TaxDocument["pipelineStatus"]>([
  "needs-review",
  "trusted",
  "rejected",
  "unclassified",
  "failed",
]);

const uploadSchema = z.object({ document: taxDocumentSchema });
const documentResponseSchema = z.object({ document: taxDocumentSchema });

type SmokeCase = {
  filename: string;
  expectedStatus: TaxDocument["pipelineStatus"];
};

const CASES: SmokeCase[] = [
  { filename: "northgate-profit-and-loss-2025.pdf", expectedStatus: "needs-review" },
  { filename: "lease-agreement.pdf", expectedStatus: "rejected" },
  { filename: "state-apportionment-schedule.pdf", expectedStatus: "unclassified" },
];

type SmokeRow = {
  filename: string;
  status: string;
  classification: string;
  confidence: string;
  fieldCount: number;
  notFoundCount: number;
  regexFailCount: number;
  expectedStatus: TaxDocument["pipelineStatus"];
  ok: boolean;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function formatConfidence(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(2);
}

function rowFromDocument(document: TaxDocument, expectedStatus: TaxDocument["pipelineStatus"]): SmokeRow {
  const fields = document.extraction?.fields ?? [];
  return {
    filename: document.filename,
    status: document.pipelineStatus,
    classification: document.classification?.documentTypeId ?? "—",
    confidence: formatConfidence(document.classification?.confidence),
    fieldCount: fields.length,
    notFoundCount: fields.filter((field) => field.notFound).length,
    regexFailCount: fields.filter((field) => field.regexPass === false).length,
    expectedStatus,
    ok: document.pipelineStatus === expectedStatus,
  };
}

function printTable(rows: SmokeRow[]): void {
  const headers = [
    "filename",
    "status",
    "classification",
    "conf",
    "fields",
    "notFound",
    "regexFail",
  ];
  const widths = [38, 14, 22, 6, 7, 8, 9];
  console.log(headers.map((header, i) => pad(header, widths[i]!)).join("  "));
  for (const row of rows) {
    const cells = [
      pad(row.filename, widths[0]!),
      pad(row.status, widths[1]!),
      pad(row.classification, widths[2]!),
      pad(row.confidence, widths[3]!),
      pad(String(row.fieldCount), widths[4]!),
      pad(String(row.notFoundCount), widths[5]!),
      pad(String(row.regexFailCount), widths[6]!),
    ];
    console.log(cells.join("  "));
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${response.url} returned non-JSON (HTTP ${response.status}): ${messageOf(error)}`,
    );
  }
}

async function uploadPdf(
  baseUrl: string,
  engagementId: string,
  filename: string,
): Promise<TaxDocument> {
  const path = join(DEMO_DIR, filename);
  const bytes = await Bun.file(path).bytes();
  const file = new File([bytes], filename, { type: "application/pdf" });
  const form = new FormData();
  form.set("file", file);
  form.set("engagementId", engagementId);

  const response = await fetch(`${baseUrl}/api/documents`, { method: "POST", body: form });
  const body = await readJson(response);
  if (response.status !== 201) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      `Upload of ${filename} failed (HTTP ${response.status}): ${error.success ? error.data.error : "unexpected body"}`,
    );
  }
  return uploadSchema.parse(body).document;
}

async function fetchDocument(baseUrl: string, id: string): Promise<TaxDocument> {
  const response = await fetch(`${baseUrl}/api/documents/${id}`);
  const body = await readJson(response);
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(
      `GET /api/documents/${id} failed (HTTP ${response.status}): ${error.success ? error.data.error : "unexpected body"}`,
    );
  }
  return documentResponseSchema.parse(body).document;
}

async function pollUntilTerminal(
  baseUrl: string,
  documentId: string,
): Promise<TaxDocument> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let latest = await fetchDocument(baseUrl, documentId);
  while (!TERMINAL_STATUSES.has(latest.pipelineStatus)) {
    if (Date.now() > deadline) {
      throw new Error(
        `${latest.filename} did not reach a terminal status within ${POLL_TIMEOUT_MS / 1000}s (last status: ${latest.pipelineStatus})`,
      );
    }
    await Bun.sleep(POLL_INTERVAL_MS);
    latest = await fetchDocument(baseUrl, documentId);
  }
  return latest;
}

function assertPdfPack(): void {
  const missing = CASES.map((item) => item.filename).filter(
    (filename) => !existsSync(join(DEMO_DIR, filename)),
  );
  if (missing.length > 0) {
    throw new Error(`Missing demo PDFs: ${missing.join(", ")}. Run bun run demo-docs first.`);
  }
}

async function resolveHeroEngagementId(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/engagements`);
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`GET /api/engagements failed (HTTP ${response.status})`);
  }
  const list = engagementListResponseSchema.parse(body);
  const hero = list.engagements.find(
    (engagement) =>
      engagement.clientName === HERO_CLIENT_NAME && engagement.filingType === "1120-S",
  );
  if (!hero) {
    throw new Error(
      `No ${HERO_CLIENT_NAME} 1120-S engagement found. Run bun run seed or start with an empty database so auto-seed can run.`,
    );
  }
  return hero.id;
}

async function main(): Promise<void> {
  if (!config.openrouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured. Add it to .env.local — Bun loads that file automatically. Do not pass the key on the command line.",
    );
  }
  assertPdfPack();

  const ai = createOpenRouterClient();
  const app = createApp({ runner: createRunner({ ai }), ai });
  const db = await connectDb();
  if (await seedIfEmpty(db)) {
    console.log("seeded demo book");
  }

  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  console.log(`smoke API at ${baseUrl} (model ${config.openrouterModel})`);

  try {
    const engagementId = await resolveHeroEngagementId(baseUrl);
    const uploaded: { id: string; expectedStatus: TaxDocument["pipelineStatus"] }[] = [];
    for (const item of CASES) {
      const document = await uploadPdf(baseUrl, engagementId, item.filename);
      console.log(`uploaded ${document.filename} → ${document.id}`);
      uploaded.push({ id: document.id, expectedStatus: item.expectedStatus });
    }

    const finished = await Promise.all(
      uploaded.map((item) => pollUntilTerminal(baseUrl, item.id)),
    );
    const rows = finished.map((document, index) => {
      const expected = uploaded[index]!.expectedStatus;
      if (document.pipelineStatus === "failed") {
        console.error(`${document.filename} failed: ${document.failure?.message ?? "unknown error"}`);
      }
      return rowFromDocument(document, expected);
    });

    printTable(rows);

    const mismatches = rows.filter((row) => !row.ok);
    if (mismatches.length > 0) {
      throw new Error(
        `Smoke assertions failed: ${mismatches
          .map((row) => `${row.filename} is ${row.status}, expected ${row.expectedStatus}`)
          .join("; ")}`,
      );
    }
    console.log("smoke ok");
  } finally {
    server.stop();
    await disconnectDb();
  }
}

try {
  await main();
} catch (error) {
  console.error(messageOf(error));
  process.exitCode = 1;
}
