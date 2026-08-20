import { describe, expect, test } from "bun:test";
import { engagementListRowSchema, type EngagementListRow } from "../../src/shared/schemas/api.ts";
import { POLL_INTERVAL_MS } from "../../src/shared/constants.ts";
import {
  engagementsPage,
  parseEngagementsFilters,
  renderEngagements,
  type EngagementsData,
  type EngagementsFilters,
} from "../../src/client/app/pages/engagements.ts";
import type { NewEngagementModalState } from "../../src/client/app/pages/new-engagement.ts";

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

function filters(overrides: Partial<EngagementsFilters> = {}): EngagementsFilters {
  return { client: "", year: "", filingType: "", stage: "", sort: "newest", ...overrides };
}

function data(overrides: Partial<EngagementsData> = {}): EngagementsData {
  return {
    engagements: [row()],
    filters: filters(),
    clients: [
      { id: "client-1", legalName: "Northwind Partners LLC" },
      { id: "client-2", legalName: "Sierra Outfitters Inc" },
    ],
    taxYears: [2026, 2025],
    ...overrides,
  };
}

describe("engagements page", () => {
  test("renders the list recipe header with the new-engagement action", () => {
    const html = renderEngagements(data());

    expect(html).toContain("Engagements");
    expect(html).toContain('href="/engagements?new=1"');
    expect(html).toContain("New engagement");
    expect(html).toContain('class="btn-primary"');
    expect(html).toContain("1–1 of 1");
  });

  test("parseEngagementsFilters defaults every filter to inactive", () => {
    expect(parseEngagementsFilters("")).toEqual(filters());
    expect(parseEngagementsFilters("?new=1")).toEqual(filters());
  });

  test("parseEngagementsFilters reads client, year, filing type, stage, and sort", () => {
    expect(
      parseEngagementsFilters("?client=client-1&year=2025&filingType=1120-S&stage=in-review&sort=oldest"),
    ).toEqual(
      filters({ client: "client-1", year: "2025", filingType: "1120-S", stage: "in-review", sort: "oldest" }),
    );
  });

  test("parseEngagementsFilters drops malformed values", () => {
    expect(parseEngagementsFilters("?year=20x5")).toEqual(filters());
    expect(parseEngagementsFilters("?filingType=1040")).toEqual(filters());
    expect(parseEngagementsFilters("?stage=bogus")).toEqual(filters());
    expect(parseEngagementsFilters("?sort=bogus")).toEqual(filters());
  });

  test("the filter bar renders selects for client, year, filing type, stage, and sort", () => {
    const html = renderEngagements(data());

    expect(html).toContain("data-filter-bar");
    expect(html).toContain('data-filter="client"');
    expect(html).toContain(">All clients<");
    expect(html).toContain('value="client-2">Sierra Outfitters Inc<');
    expect(html).toContain('data-filter="year"');
    expect(html).toContain(">All years<");
    expect(html).toContain('value="2026">2026<');
    expect(html).toContain('data-filter="filingType"');
    expect(html).toContain(">All filing types<");
    expect(html).toContain('value="1120-S">1120-S<');
    expect(html).toContain('data-filter="stage"');
    expect(html).toContain(">All stages<");
    expect(html).toContain('value="in-review">In review<');
    expect(html).toContain('data-filter="sort"');
    expect(html).toContain(">Newest first<");
    expect(html).toContain(">Oldest first<");
  });

  test("selects initialize from the URL-derived filters", () => {
    const html = renderEngagements(
      data({ filters: filters({ client: "client-1", year: "2025", filingType: "1065", stage: "collecting", sort: "oldest" }) }),
    );

    expect(html).toContain('value="client-1" selected');
    expect(html).toContain('value="2025" selected');
    expect(html).toContain('value="1065" selected');
    expect(html).toContain('value="collecting" selected');
    expect(html).toContain('value="oldest" selected');
  });

  test("a quiet clear-filters link appears only while a filter is active", () => {
    const idle = renderEngagements(data());
    const active = renderEngagements(data({ filters: filters({ stage: "in-review" }) }));

    expect(idle).not.toContain("Clear filters");
    expect(active).toContain(">Clear filters<");
    expect(active).toContain('href="/engagements"');
  });

  test("zero matches with active filters renders the honest empty state", () => {
    const html = renderEngagements(data({ engagements: [], filters: filters({ client: "client-2" }) }));

    expect(html).toContain("No engagements match these filters");
    expect(html).not.toContain("<table");
  });

  test("zero engagements without filters keeps the create-one empty state", () => {
    const html = renderEngagements(data({ engagements: [] }));

    expect(html).toContain("No engagements yet. Create one to request client documents.");
    expect(html).not.toContain("No engagements match these filters");
  });

  test("renders client entity cells, stage chips, document progress, and workspace rows", () => {
    const html = renderEngagements(data());

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
    const withReviews = renderEngagements(data());
    const withoutReviews = renderEngagements(
      data({ engagements: [row({ docCounts: { total: 4, needsReview: 0 } })] }),
    );

    expect(withReviews).toContain('<span class="chip chip-warning">2 need review</span>');
    expect(withoutReviews).toContain('<span class="chip chip-processing">0 need review</span>');
    expect(withReviews).not.toContain('class="status');
  });

  test("opens the modal when query state requests it", () => {
    const html = renderEngagements(data({ showNewEngagementModal: true }));

    expect(html).toContain('data-new-engagement-modal');
    expect(html).toContain("Create engagement");
  });

  test("the success panel portal link is the shared compact control", () => {
    const success: NewEngagementModalState = {
      step: "success",
      mode: "existing",
      selectedClientId: "client-1",
      taxYear: 2025,
      filingType: "1120-S",
      clients: [],
      documentTypes: [],
      items: [],
      portalToken: "portal-token",
      engagementId: "eng-1",
    };
    const html = renderEngagements(data({ showNewEngagementModal: true, newEngagement: success }));

    expect(html).toContain("data-portal-link-control");
    expect(html).toContain('data-copy-portal-link="/portal/portal-token"');
    expect(html).toContain("Open engagement");
    expect(html).toContain('href="/engagements/eng-1"');
    expect(html).not.toContain('class="btn-secondary" type="button" data-copy-portal-link');
    expect(html).not.toContain('class="text-link" href="/portal/portal-token"');
  });

  test("escapes client names instead of injecting them", () => {
    const html = renderEngagements(data({ engagements: [row({ clientName: '<img src="x">' })] }));

    expect(html).not.toContain('<img src="x">');
    expect(html).toContain("&lt;img src=&quot;x&quot;&gt;");
  });

  test("polls on the shared live interval", () => {
    expect(engagementsPage.pollMs).toBe(POLL_INTERVAL_MS);
  });
});
