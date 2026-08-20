import { describe, expect, test } from "bun:test";
import {
  documentsPage,
  parseDocumentsTab,
  renderDocuments,
  type DocumentsData,
} from "../../src/client/app/pages/documents.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { documentListRowSchema } from "../../src/shared/schemas/api.ts";

const now = new Date("2026-08-19T20:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return documentListRowSchema.parse({
    id: "doc-1",
    engagementId: "eng-1",
    filename: "northwind-w2.pdf",
    mimeType: "application/pdf",
    size: 2048,
    storagePath: "data/uploads/doc-1.pdf",
    uploadedBy: "client",
    pipelineStatus: "needs-review",
    createdAt: "2026-08-19T18:00:00.000Z",
    updatedAt: "2026-08-19T18:00:00.000Z",
    clientName: "Northwind Partners LLC",
    engagementLabel: "2025 1120-S",
    documentTypeName: "W-2",
    ...overrides,
  });
}

function data(overrides: Partial<DocumentsData> = {}): DocumentsData {
  return {
    documents: [
      row(),
      row({ id: "doc-2", pipelineStatus: "trusted" }),
      row({ id: "doc-3", pipelineStatus: "extracting" }),
      row({ id: "doc-4", pipelineStatus: "unclassified" }),
    ],
    tab: "needs-review",
    now,
    ...overrides,
  };
}

describe("documents page", () => {
  test("parseDocumentsTab defaults to needs-review", () => {
    expect(parseDocumentsTab("")).toBe("needs-review");
    expect(parseDocumentsTab("?")).toBe("needs-review");
    expect(parseDocumentsTab("?other=1")).toBe("needs-review");
  });

  test("parseDocumentsTab reads tab query values", () => {
    expect(parseDocumentsTab("?tab=approved")).toBe("approved");
    expect(parseDocumentsTab("?tab=all")).toBe("all");
    expect(parseDocumentsTab("?tab=needs-review")).toBe("needs-review");
  });

  test("tabs show live counts for needs review, approved, and all", () => {
    const html = renderDocuments(data());

    expect(html).toContain('href="/documents?tab=needs-review"');
    expect(html).toContain('href="/documents?tab=approved"');
    expect(html).toContain('href="/documents?tab=all"');
    expect(html).toContain("Needs review");
    expect(html).toContain("Approved");
    expect(html).toContain("All");
    expect(html).toContain('class="tab is-active"');
    expect(html).toContain('>2<');
    expect(html).toContain('>1<');
    expect(html).toContain('>4<');
  });

  test("needs-review tab lists only review-queue documents with review hrefs", () => {
    const html = renderDocuments(data({ tab: "needs-review" }));

    expect(html).toContain('data-href="/engagements/eng-1/review/doc-1"');
    expect(html).toContain('data-href="/engagements/eng-1/review/doc-4"');
    expect(html).not.toContain('data-href="/engagements/eng-1/review/doc-2"');
    expect(html).not.toContain('data-href="/engagements/eng-1/review/doc-3"');
    expect(html).toContain("W-2");
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("2025 1120-S");
  });

  test("pipeline chips use semantic tones, never the highlighter", () => {
    const html = renderDocuments(
      data({
        tab: "all",
        documents: [
          row({ id: "doc-nr", pipelineStatus: "needs-review" }),
          row({ id: "doc-trusted", pipelineStatus: "trusted" }),
          row({ id: "doc-extracting", pipelineStatus: "extracting" }),
          row({ id: "doc-failed", pipelineStatus: "failed" }),
        ],
      }),
    );

    expect(html).toContain('class="chip chip-warning"');
    expect(html).toContain('class="chip chip-success"');
    expect(html).toContain('class="chip chip-processing"');
    expect(html).toContain('class="chip chip-halted"');
    expect(html).not.toContain("#e4f222");
  });

  test("polls on the shared interval", () => {
    expect(documentsPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
