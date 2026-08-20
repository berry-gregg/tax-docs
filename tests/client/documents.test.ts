import { describe, expect, test } from "bun:test";
import {
  documentsPage,
  parseDocumentsFilters,
  parseDocumentsTab,
  renderDocuments,
  type DocumentsData,
  type DocumentsFilters,
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

function filters(overrides: Partial<DocumentsFilters> = {}): DocumentsFilters {
  return { tab: "needs-review", client: "", year: "", type: "", sort: "newest", ...overrides };
}

function data(overrides: Partial<DocumentsData> = {}): DocumentsData {
  return {
    documents: [
      row(),
      row({ id: "doc-2", pipelineStatus: "trusted" }),
      row({ id: "doc-3", pipelineStatus: "extracting" }),
      row({ id: "doc-4", pipelineStatus: "unclassified" }),
    ],
    filters: filters(),
    clients: [
      { id: "client-1", legalName: "Northwind Partners LLC" },
      { id: "client-2", legalName: "Sierra Outfitters Inc" },
    ],
    documentTypes: [
      { id: "dt-w2", name: "W-2" },
      { id: "dt-pl", name: "Profit & Loss" },
    ],
    taxYears: [2026, 2025],
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

  test("parseDocumentsFilters defaults every filter to inactive", () => {
    expect(parseDocumentsFilters("")).toEqual(filters());
    expect(parseDocumentsFilters("?tab=all")).toEqual(filters({ tab: "all" }));
  });

  test("parseDocumentsFilters reads client, year, type, and sort from the URL", () => {
    expect(parseDocumentsFilters("?tab=all&client=client-1&year=2025&type=dt-w2&sort=oldest")).toEqual(
      filters({ tab: "all", client: "client-1", year: "2025", type: "dt-w2", sort: "oldest" }),
    );
  });

  test("parseDocumentsFilters drops malformed year and sort values", () => {
    expect(parseDocumentsFilters("?year=20x5")).toEqual(filters());
    expect(parseDocumentsFilters("?sort=upside-down")).toEqual(filters());
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

  test("tab links carry the active filters so switching tabs keeps the view", () => {
    const html = renderDocuments(data({ filters: filters({ client: "client-1", sort: "oldest" }) }));

    expect(html).toContain('href="/documents?tab=approved&client=client-1&sort=oldest"');
    expect(html).toContain('href="/documents?tab=all&client=client-1&sort=oldest"');
  });

  test("the filter bar renders selects bound to real clients, years, types, and sort", () => {
    const html = renderDocuments(data());

    expect(html).toContain('data-filter-bar');
    expect(html).toContain('data-filter="client"');
    expect(html).toContain(">All clients<");
    expect(html).toContain('value="client-2">Sierra Outfitters Inc<');
    expect(html).toContain('data-filter="year"');
    expect(html).toContain(">All years<");
    expect(html).toContain('value="2025">2025<');
    expect(html).toContain('data-filter="type"');
    expect(html).toContain(">All types<");
    expect(html).toContain('value="dt-pl">Profit &amp; Loss<');
    expect(html).toContain('data-filter="sort"');
    expect(html).toContain(">Newest first<");
    expect(html).toContain(">Oldest first<");
    expect(html).toContain(">Client<");
    expect(html).toContain(">Tax year<");
    expect(html).toContain(">Document type<");
    expect(html).toContain(">Sort<");
  });

  test("selects initialize from the URL-derived filters", () => {
    const html = renderDocuments(
      data({ filters: filters({ client: "client-1", year: "2025", type: "dt-w2", sort: "oldest" }) }),
    );

    expect(html).toContain('value="client-1" selected');
    expect(html).toContain('value="2025" selected');
    expect(html).toContain('value="dt-w2" selected');
    expect(html).toContain('value="oldest" selected');
  });

  test("a quiet clear-filters link appears only while a filter is active", () => {
    const idle = renderDocuments(data());
    const active = renderDocuments(data({ filters: filters({ client: "client-1" }) }));

    expect(idle).not.toContain("Clear filters");
    expect(active).toContain(">Clear filters<");
    expect(active).toContain('href="/documents?tab=needs-review"');
  });

  test("zero matches with active filters renders the honest empty state", () => {
    const html = renderDocuments(data({ documents: [], filters: filters({ client: "client-2" }) }));

    expect(html).toContain("No documents match these filters");
    expect(html).not.toContain("<table");
  });

  test("zero documents without filters keeps the plain table", () => {
    const html = renderDocuments(data({ documents: [] }));

    expect(html).not.toContain("No documents match these filters");
    expect(html).toContain("0 documents");
  });

  test("needs-review tab lists only review-queue documents with review hrefs", () => {
    const html = renderDocuments(data({ filters: filters({ tab: "needs-review" }) }));

    expect(html).toContain('data-href="/documents/doc-1"');
    expect(html).toContain('data-href="/documents/doc-4"');
    expect(html).not.toContain('data-href="/documents/doc-2"');
    expect(html).not.toContain('data-href="/documents/doc-3"');
    expect(html).toContain("W-2");
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("2025 1120-S");
  });

  test("pipeline chips use semantic tones, never the highlighter", () => {
    const html = renderDocuments(
      data({
        filters: filters({ tab: "all" }),
        documents: [
          row({ id: "doc-nr", pipelineStatus: "needs-review" }),
          row({ id: "doc-trusted", pipelineStatus: "trusted" }),
          row({ id: "doc-extracting", pipelineStatus: "extracting" }),
          row({ id: "doc-failed", pipelineStatus: "failed" }),
        ],
      }),
    );

    expect(html).toContain('<span class="chip chip-warning">Needs review</span>');
    expect(html).toContain('class="chip chip-success"');
    expect(html).toContain('class="chip chip-processing"');
    expect(html).toContain('class="chip chip-halted"');
    expect(html).not.toContain("#e4f222");
  });

  test("polls on the shared interval", () => {
    expect(documentsPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
