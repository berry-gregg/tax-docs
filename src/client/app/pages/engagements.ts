import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  clientListResponseSchema,
  engagementListResponseSchema,
  type EngagementListRow,
} from "../../../shared/schemas/api.ts";
import type { Engagement } from "../../../shared/schemas/engagement.ts";
import { getJson } from "../api.ts";
import {
  bindFilterBar,
  filterBar,
  filterSelect,
  type FilterOption,
} from "../components/filter-bar.ts";
import {
  bindRowLinks,
  dataTable,
  emptyState,
  entityCell,
  escapeHtml,
  initialsFor,
  pageHeader,
  stageChip,
} from "../render.ts";
import {
  bindNewEngagementModal,
  clearNewEngagementDraft,
  initialNewEngagementState,
  loadNewEngagementState,
  renderNewEngagementModal,
  type NewEngagementModalState,
} from "./new-engagement.ts";
import type { PageModule } from "./registry.ts";

type EngagementStage = Engagement["status"];
type FilingType = Engagement["filingType"];

export type EngagementsFilters = {
  /** Client id, or "" for all clients. */
  client: string;
  /** Four-digit tax year as it appears in the URL, or "". */
  year: string;
  filingType: "" | FilingType;
  stage: "" | EngagementStage;
  sort: "newest" | "oldest";
};

export type EngagementsData = {
  engagements: EngagementListRow[];
  filters: EngagementsFilters;
  clients: { id: string; legalName: string }[];
  taxYears: number[];
  showNewEngagementModal?: boolean;
  newEngagement?: NewEngagementModalState;
};

const FILING_TYPES: FilingType[] = ["1120-S", "1065"];

/** Sentence-case stage labels, matching the `stageChip` vocabulary. */
const STAGE_LABELS: Record<EngagementStage, string> = {
  draft: "Draft",
  collecting: "Collecting",
  "in-review": "In review",
  "ready-to-export": "Ready to export",
  exported: "Exported",
};

function isStage(value: string): value is EngagementStage {
  return value in STAGE_LABELS;
}

function isFilingType(value: string): value is FilingType {
  return FILING_TYPES.includes(value as FilingType);
}

/** Reads the full filter state from the URL; malformed values fall back to inactive. */
export function parseEngagementsFilters(search: string): EngagementsFilters {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const year = params.get("year") ?? "";
  const filingType = params.get("filingType") ?? "";
  const stage = params.get("stage") ?? "";

  return {
    client: params.get("client") ?? "",
    year: /^\d{4}$/.test(year) ? year : "",
    filingType: isFilingType(filingType) ? filingType : "",
    stage: isStage(stage) ? stage : "",
    sort: params.get("sort") === "oldest" ? "oldest" : "newest",
  };
}

/** Page URL for a filter state — "/engagements" when nothing is active. */
export function engagementsHref(filters: EngagementsFilters): string {
  const params = new URLSearchParams();
  if (filters.client) {
    params.set("client", filters.client);
  }
  if (filters.year) {
    params.set("year", filters.year);
  }
  if (filters.filingType) {
    params.set("filingType", filters.filingType);
  }
  if (filters.stage) {
    params.set("stage", filters.stage);
  }
  if (filters.sort !== "newest") {
    params.set("sort", filters.sort);
  }
  const query = params.toString();
  return query.length > 0 ? `/engagements?${query}` : "/engagements";
}

function engagementsApiUrl(filters: EngagementsFilters): string {
  const params = new URLSearchParams();
  if (filters.client) {
    params.set("clientId", filters.client);
  }
  if (filters.year) {
    params.set("taxYear", filters.year);
  }
  if (filters.filingType) {
    params.set("filingType", filters.filingType);
  }
  if (filters.stage) {
    params.set("status", filters.stage);
  }
  if (filters.sort !== "newest") {
    params.set("sort", filters.sort);
  }
  const query = params.toString();
  return query.length > 0 ? `/api/engagements?${query}` : "/api/engagements";
}

export function applyEngagementsFilter(
  filters: EngagementsFilters,
  name: string,
  value: string,
): EngagementsFilters {
  if (name === "client") {
    return { ...filters, client: value };
  }
  if (name === "year") {
    return { ...filters, year: value };
  }
  if (name === "filingType") {
    return { ...filters, filingType: isFilingType(value) ? value : "" };
  }
  if (name === "stage") {
    return { ...filters, stage: isStage(value) ? value : "" };
  }
  if (name === "sort") {
    return { ...filters, sort: value === "oldest" ? "oldest" : "newest" };
  }
  return filters;
}

function hasActiveFilters(filters: EngagementsFilters): boolean {
  return (
    filters.client !== "" || filters.year !== "" || filters.filingType !== "" || filters.stage !== ""
  );
}

function renderFilterBar(data: EngagementsData): string {
  const clientOptions: FilterOption[] = [
    { value: "", label: "All clients" },
    ...data.clients.map((client) => ({ value: client.id, label: client.legalName })),
  ];
  const yearOptions: FilterOption[] = [
    { value: "", label: "All years" },
    ...data.taxYears.map((year) => ({ value: String(year), label: String(year) })),
  ];
  const filingTypeOptions: FilterOption[] = [
    { value: "", label: "All filing types" },
    ...FILING_TYPES.map((filingType) => ({ value: filingType, label: filingType })),
  ];
  const stageOptions: FilterOption[] = [
    { value: "", label: "All stages" },
    ...Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label })),
  ];
  const sortOptions: FilterOption[] = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
  ];

  return filterBar(
    [
      filterSelect({ name: "client", label: "Client", options: clientOptions, selected: data.filters.client }),
      filterSelect({ name: "year", label: "Tax year", options: yearOptions, selected: data.filters.year }),
      filterSelect({ name: "filingType", label: "Filing type", options: filingTypeOptions, selected: data.filters.filingType }),
      filterSelect({ name: "stage", label: "Stage", options: stageOptions, selected: data.filters.stage }),
      filterSelect({ name: "sort", label: "Sort", options: sortOptions, selected: data.filters.sort }),
    ],
    hasActiveFilters(data.filters) ? "/engagements" : null,
  );
}

export function renderEngagements(data: EngagementsData): string {
  const rows = data.engagements.map(renderEngagementRow);
  const modal = data.showNewEngagementModal
    ? renderNewEngagementModal(
        data.newEngagement ?? initialNewEngagementState({ clients: [], documentTypes: [] }),
      )
    : "";
  const body =
    rows.length === 0
      ? emptyState(
          hasActiveFilters(data.filters)
            ? "No engagements match these filters"
            : "No engagements yet. Create one to request client documents.",
        )
      : dataTable(
          ["Client", "Filing type", "Tax year", "Stage", "Docs progress", "Needs review"],
          rows,
          `1–${rows.length} of ${rows.length}`,
        );

  return `<section>
    ${pageHeader("Engagements", String(data.engagements.length), [
      { href: "/engagements?new=1", label: "New engagement", kind: "primary" },
    ])}
    ${renderFilterBar(data)}
    ${body}
    ${modal}
  </section>`;
}

function renderEngagementRow(row: EngagementListRow): string {
  const totalRequested = row.docCounts.total + row.openItems;
  const progress =
    totalRequested === 0
      ? "No requests yet"
      : `${row.docCounts.total} of ${totalRequested} received`;
  const needsReview =
    row.docCounts.needsReview === 1 ? "1 needs review" : `${row.docCounts.needsReview} need review`;
  // The same phrase as the Documents/review chips: warning while work waits, ash at zero.
  const needsReviewTone = row.docCounts.needsReview > 0 ? "warning" : "processing";

  return `<tr data-href="/engagements/${escapeHtml(row.id)}" tabindex="0">
    <td>${entityCell(
      initialsFor(row.clientName),
      row.clientName,
      row.clientId,
    )}</td>
    <td>${escapeHtml(row.filingType)}</td>
    <td>${row.taxYear}</td>
    <td>${stageChip(row.status)}</td>
    <td>${escapeHtml(progress)}</td>
    <td><span class="chip chip-${needsReviewTone}">${escapeHtml(needsReview)}</span></td>
  </tr>`;
}

function modalRequested(): { show: boolean; clientId?: string; filingType?: "1120-S" | "1065" } {
  const search = globalThis.location?.search ?? "";
  const params = new URLSearchParams(search);
  const clientId = params.get("client") ?? undefined;
  const filingTypeParam = params.get("filingType");
  const filingType = filingTypeParam === "1065" ? "1065" : filingTypeParam === "1120-S" ? "1120-S" : undefined;
  return { show: params.get("new") === "1", clientId, filingType };
}

export const engagementsPage: PageModule<EngagementsData> = {
  async load() {
    const filters = parseEngagementsFilters(window.location.search);
    const [engagements, clients, unfiltered, modalState] = await Promise.all([
      getJson(engagementsApiUrl(filters), engagementListResponseSchema),
      getJson("/api/clients", clientListResponseSchema),
      // Year options must not shrink to the filtered result; reuse the main fetch when it
      // already covers everything.
      hasActiveFilters(filters)
        ? getJson("/api/engagements", engagementListResponseSchema)
        : Promise.resolve(undefined),
      (async () => {
        const requested = modalRequested();
        if (!requested.show) {
          clearNewEngagementDraft();
          return undefined;
        }
        return loadNewEngagementState(requested.clientId, requested.filingType ?? "1120-S");
      })(),
    ]);
    const yearSource = unfiltered ?? engagements;
    const taxYears = [...new Set(yearSource.engagements.map((row) => row.taxYear))].sort(
      (a, b) => b - a,
    );

    return {
      engagements: engagements.engagements,
      filters,
      clients: clients.clients.map((client) => ({ id: client.id, legalName: client.legalName })),
      taxYears,
      showNewEngagementModal: modalState !== undefined,
      newEngagement: modalState,
    };
  },
  render: renderEngagements,
  bind(root, data, repaint) {
    bindRowLinks(root, repaint);
    bindFilterBar(
      root,
      (name, value) => engagementsHref(applyEngagementsFilter(data.filters, name, value)),
      repaint,
    );
    if (!data.newEngagement) return;

    let modalState = data.newEngagement;
    bindNewEngagementModal(root, {
      state: modalState,
      setState(next) {
        modalState = next;
        data.newEngagement = next;
      },
      repaint,
    });
  },
  pollMs: POLL_INTERVAL_MS,
};
