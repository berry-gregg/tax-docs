import { describe, expect, test } from "bun:test";
import { exportPage, renderExport, type ExportData } from "../../src/client/app/pages/export.ts";
import { exportSchema } from "../../src/shared/schemas/export.ts";

const iso = "2026-08-19T18:00:00.000Z";

const draftExport = exportSchema.parse({
  id: "exp-1",
  engagementId: "eng-1",
  status: "draft",
  lines: [
    {
      engineForm: "Form 1120-S",
      lineId: "8",
      lineLabel: "Salaries and wages",
      value: 512000,
      sourceRefs: [{ documentId: "doc-pl", fieldKey: "salaries_wages" }],
    },
    {
      engineForm: "Form 1120-S",
      lineId: "11",
      lineLabel: "Rents",
      value: null,
      sourceRefs: [],
    },
  ],
  createdAt: iso,
  payloadJson: "{}",
});

const sentExport = exportSchema.parse({
  ...draftExport,
  status: "sent",
  confirmedAt: "2026-08-19T19:00:00.000Z",
});

function data(overrides: Partial<ExportData> = {}): ExportData {
  return {
    engagementId: "eng-1",
    clientName: "Northwind Partners LLC",
    taxYear: 2025,
    filingType: "1120-S",
    export: draftExport,
    blocked: null,
    ...overrides,
  };
}

describe("export page", () => {
  test("line rows format money and show missing trusted-source state", () => {
    const html = renderExport(data());

    expect(html).toContain("$512,000.00");
    expect(html).toContain("Missing — no trusted source");
    expect(html).toContain("Salaries and wages");
    expect(html).toContain("Rents");
    expect(html).toContain("Form 1120-S");
  });

  test("source refs link to each document review page", () => {
    const html = renderExport(data());

    expect(html).toContain('href="/engagements/eng-1/review/doc-pl"');
    expect(html).toContain("salaries_wages");
  });

  test("confirm modal copy includes human confirmation and line count context", () => {
    const html = renderExport(data());

    expect(html).toContain("human confirmation");
    expect(html).toContain("This sends 2 line items for Northwind Partners LLC 2025 1120-S to the tax engine");
    expect(html).toContain("nothing has been sent yet");
    expect(html).toContain("Confirm &amp; send to tax engine");
  });

  test("sent state shows success banner and download payload href", () => {
    const html = renderExport(data({ export: sentExport }));

    expect(html).toContain('href="/api/exports/exp-1/payload"');
    expect(html).toContain("Download payload");
    expect(html).toContain("2026-08-19T19:00:00.000Z");
    expect(html).toContain("Salaries and wages");
    expect(html).not.toContain("Confirm &amp; send to tax engine");
  });

  test("409 blocked state renders the server message and workspace link", () => {
    const html = renderExport(
      data({
        export: null,
        blocked: "No trusted documents to export",
      }),
    );

    expect(html).toContain("No trusted documents to export");
    expect(html).toContain('href="/engagements/eng-1"');
  });

  test("missing values use muted ash, not warning or inverted surfaces", () => {
    const html = renderExport(data());

    expect(html).toContain('<span class="muted">Missing — no trusted source</span>');
    expect(html).not.toContain("chip-warning");
    expect(html).not.toContain("surface-inverted");
    expect(html).not.toContain("box-shadow");
  });

  test("only the confirm action uses the highlighter primary button", () => {
    const draftHtml = renderExport(data());
    const sentHtml = renderExport(data({ export: sentExport }));

    expect(draftHtml).toContain('class="btn-primary" type="button" data-export-open');
    expect(sentHtml).toContain('class="btn-secondary"');
    expect(sentHtml).not.toContain("btn-primary");
  });

  test("export page module exposes load and render", () => {
    expect(typeof exportPage.load).toBe("function");
    expect(typeof exportPage.render).toBe("function");
    expect(typeof exportPage.bind).toBe("function");
  });
});
