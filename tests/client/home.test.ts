import { describe, expect, test } from "bun:test";
import { homePage, renderHome, type HomeData } from "../../src/client/app/pages/home.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { documentListRowSchema, metricsSchema } from "../../src/shared/schemas/api.ts";

const now = new Date("2026-08-19T20:00:00");

const metrics = metricsSchema.parse({
  documentsAutoProcessed: 12,
  fieldsAwaitingReview: 7,
  straightThroughRate: 86,
  needsReviewCount: 3,
  outstandingRequests: 2,
  activeClients: 4,
});

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

function data(overrides: Partial<HomeData> = {}): HomeData {
  return { metrics, recent: [row()], now, ...overrides };
}

describe("home page", () => {
  test("headline states the live review count from /api/metrics", () => {
    const html = renderHome(data());

    expect(html).toContain("3 documents need review");
    expect(html).toContain("7 extracted fields still need a person");
    expect(html).toContain("Good evening");
    expect(html).not.toContain("Welcome back");
  });

  test("headline and wash card use singular copy at one", () => {
    const html = renderHome(
      data({
        metrics: metricsSchema.parse({ ...metrics, needsReviewCount: 1, fieldsAwaitingReview: 1 }),
      }),
    );

    expect(html).toContain('<h1 class="page-title">1 document needs review</h1>');
    expect(html).not.toContain("1 documents need review");
    expect(html).toContain("1 extracted field still needs a person");
    expect(html).not.toContain("1 extracted fields");
  });

  test("a queued document with no extracted fields uses honest wash copy", () => {
    const html = renderHome(
      data({
        metrics: metricsSchema.parse({ ...metrics, needsReviewCount: 2, fieldsAwaitingReview: 0 }),
      }),
    );

    expect(html).toContain("2 documents need review");
    expect(html).toContain("No extracted fields are waiting");
    expect(html).not.toContain("0 extracted fields");
  });

  test("recent document rows deep-link into the document review page", () => {
    const html = renderHome(data());

    expect(html).toContain('href="/documents/doc-1"');
    expect(html).toContain("W-2");
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("Recent documents");
  });

  test("recent rows are dense single-line rows with the filename shown exactly once", () => {
    const html = renderHome(data());

    expect(html).toContain('class="row-list row-list-dense"');
    expect(html.split("northwind-w2.pdf").length - 1).toBe(1);
  });

  test("View all documents links to the documents all tab", () => {
    const html = renderHome(data());

    expect(html).toMatch(/href="\/documents\?tab=all"[^>]*>View all documents/);
  });

  test("shows at most five recent documents", () => {
    const recent = Array.from({ length: 7 }, (_, index) =>
      row({ id: `doc-${index}`, filename: `doc-${index}.pdf` }),
    );

    const html = renderHome(data({ recent }));

    expect(html).toContain('href="/documents/doc-4"');
    expect(html).not.toContain('href="/documents/doc-5"');
  });

  test("pipeline chips use semantic tones, never the highlighter", () => {
    const html = renderHome(
      data({
        recent: [
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
    expect(html).not.toContain("highlighter");
    expect(html).not.toContain("#e4f222");
  });

  test("home no longer renders the metrics ticker strip", () => {
    const html = renderHome(data());

    expect(html).not.toContain('class="ticker"');
    expect(html).not.toContain("Documents auto-processed");
    expect(html).not.toContain("Straight-through rate");
  });

  test("rail leads with New engagement and the review-queue deep link", () => {
    const html = renderHome(data());

    expect(html).toContain("New engagement");
    expect(html).toContain('href="/engagements?new=1"');
    expect(html).toContain("Open review queue");
    expect(html).toContain('href="/documents?tab=needs-review"');
    expect(html).toContain('class="btn-primary btn-block"');
  });

  test("rail widgets carry live counts and their own deep links", () => {
    const html = renderHome(data());

    expect(html).toContain("Active clients");
    expect(html).toContain('href="/clients"');
    expect(html).toContain("Review queue");
    expect(html).toContain("Outstanding requests");
    expect(html).toContain('href="/inbox"');
    expect(html).toContain("4");
    expect(html).toContain("2");
  });

  test("an empty queue says so instead of showing a stale count", () => {
    const html = renderHome(
      data({
        metrics: metricsSchema.parse({ ...metrics, needsReviewCount: 0, fieldsAwaitingReview: 0 }),
        recent: [],
      }),
    );

    expect(html).toContain('<h1 class="page-title">Nothing is waiting on you</h1>');
    expect(html).not.toContain("0 documents need review");
    expect(html).toContain("Nothing is waiting on you");
    expect(html).toContain("No documents yet");
  });

  test("client names are escaped, not injected", () => {
    const html = renderHome(data({ recent: [row({ clientName: '<script>x</script>' })] }));

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("polls on the shared interval", () => {
    expect(homePage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
