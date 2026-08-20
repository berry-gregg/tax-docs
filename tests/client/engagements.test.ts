import { describe, expect, test } from "bun:test";
import { engagementListRowSchema, type EngagementListRow } from "../../src/shared/schemas/api.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import { engagementsPage, renderEngagements } from "../../src/client/app/pages/engagements.ts";

function row(overrides: Record<string, unknown> = {}): EngagementListRow {
  return engagementListRowSchema.parse({
    id: "eng-1",
    clientId: "client-1",
    clientName: "Northwind Partners LLC",
    taxYear: 2025,
    filingType: "1120-S",
    status: "collecting",
    portalToken: "portal-token",
    createdAt: "2026-08-19T18:00:00.000Z",
    updatedAt: "2026-08-19T18:00:00.000Z",
    docCounts: {
      total: 4,
      needsReview: 2,
    },
    openItems: 3,
    ...overrides,
  });
}

describe("engagements page", () => {
  test("renders the list recipe header with the new-engagement action", () => {
    const html = renderEngagements({ engagements: [row()] });

    expect(html).toContain("Engagements");
    expect(html).toContain('href="/engagements?new=1"');
    expect(html).toContain("New engagement");
    expect(html).toContain('class="btn-primary"');
    expect(html).toContain("1–1 of 1");
  });

  test("renders client entity cells, stage chips, document progress, and workspace rows", () => {
    const html = renderEngagements({ engagements: [row()] });

    expect(html).toContain("NP");
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("1120-S");
    expect(html).toContain("2025");
    expect(html).toContain("Collecting");
    expect(html).toContain('<span class="chip chip-processing">Collecting</span>');
    expect(html).toContain("4 of 7 received");
    expect(html).toContain("2 need review");
    expect(html).toContain('<tr data-href="/engagements/eng-1" tabindex="0">');
    expect(html).not.toContain('<a href="/engagements/eng-1"');
  });

  test("the needs-review count is the shared warning chip, ash at zero, never bare status text", () => {
    const withReviews = renderEngagements({ engagements: [row()] });
    const withoutReviews = renderEngagements({
      engagements: [row({ docCounts: { total: 4, needsReview: 0 } })],
    });

    expect(withReviews).toContain('<span class="chip chip-warning">2 need review</span>');
    expect(withoutReviews).toContain('<span class="chip chip-processing">0 need review</span>');
    expect(withReviews).not.toContain('class="status');
  });

  test("opens the modal when query state requests it", () => {
    const html = renderEngagements({ engagements: [row()], showNewEngagementModal: true });

    expect(html).toContain('data-new-engagement-modal');
    expect(html).toContain("Create engagement");
  });

  test("escapes client names instead of injecting them", () => {
    const html = renderEngagements({
      engagements: [row({ clientName: '<img src="x">' })],
    });

    expect(html).not.toContain('<img src="x">');
    expect(html).toContain("&lt;img src=&quot;x&quot;&gt;");
  });

  test("polls on the shared live interval", () => {
    expect(engagementsPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
