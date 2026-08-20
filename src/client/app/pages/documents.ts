import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  clientListResponseSchema,
  documentListResponseSchema,
  documentTypesResponseSchema,
  engagementListResponseSchema,
  type DocumentListRow,
} from "../../../shared/schemas/api.ts";
import { getJson } from "../api.ts";
import {
  bindFilterBar,
  filterBar,
  filterSelect,
  type FilterOption,
} from "../components/filter-bar.ts";
import { formatRelativeTime } from "../format.ts";
import {
  bindRowLinks,
  dataTable,
  emptyState,
  entityCell,
  escapeHtml,
  initialsFor,
  pageHeader,
  pipelineChip,
  tabs,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

export type DocumentsTab = "needs-review" | "approved" | "all";

export type DocumentsFilters = {
  tab: DocumentsTab;
  /** Client id, or "" for all clients. */
  client: string;
  /** Four-digit tax year as it appears in the URL, or "". */
  year: string;
  /** Document type id, or "" for all types. */
  type: string;
  sort: "newest" | "oldest";
};

export type DocumentsData = {
  documents: DocumentListRow[];
  filters: DocumentsFilters;
  clients: { id: string; legalName: string }[];
  documentTypes: { id: string; name: string }[];
  taxYears: number[];
  now: Date;
};

export function parseDocumentsTab(search: string): DocumentsTab {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const tab = new URLSearchParams(query).get("tab");

  if (tab === "approved" || tab === "all" || tab === "needs-review") {
    return tab;
  }

  return "needs-review";
}

/** Reads the full filter state from the URL; malformed values fall back to inactive. */
export function parseDocumentsFilters(search: string): DocumentsFilters {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const year = params.get("year") ?? "";

  return {
    tab: parseDocumentsTab(search),
    client: params.get("client") ?? "",
    year: /^\d{4}$/.test(year) ? year : "",
    type: params.get("type") ?? "",
    sort: params.get("sort") === "oldest" ? "oldest" : "newest",
  };
}

/** Page URL for a filter state — the shareable, deep-linkable form. */
export function documentsHref(filters: DocumentsFilters, tab?: DocumentsTab): string {
  const params = new URLSearchParams();
  params.set("tab", tab ?? filters.tab);
  if (filters.client) {
    params.set("client", filters.client);
  }
  if (filters.year) {
    params.set("year", filters.year);
  }
  if (filters.type) {
    params.set("type", filters.type);
  }
  if (filters.sort !== "newest") {
    params.set("sort", filters.sort);
  }
  return `/documents?${params.toString()}`;
}

/**
 * API url for a filter state. Always `group=all`: the tabs slice client-side so their counts
 * stay live; client/year/type/sort narrow on the server.
 */
function documentsApiUrl(filters: DocumentsFilters): string {
  const params = new URLSearchParams({ group: "all" });
  if (filters.client) {
    params.set("clientId", filters.client);
  }
  if (filters.year) {
    params.set("taxYear", filters.year);
  }
  if (filters.type) {
    params.set("documentTypeId", filters.type);
  }
  if (filters.sort !== "newest") {
    params.set("sort", filters.sort);
  }
  return `/api/documents?${params.toString()}`;
}

export function applyDocumentsFilter(
  filters: DocumentsFilters,
  name: string,
  value: string,
): DocumentsFilters {
  if (name === "client") {
    return { ...filters, client: value };
  }
  if (name === "year") {
    return { ...filters, year: value };
  }
  if (name === "type") {
    return { ...filters, type: value };
  }
  if (name === "sort") {
    return { ...filters, sort: value === "oldest" ? "oldest" : "newest" };
  }
  return filters;
}

function hasActiveFilters(filters: DocumentsFilters): boolean {
  return filters.client !== "" || filters.year !== "" || filters.type !== "";
}

function tabCounts(documents: DocumentListRow[]) {
  return {
    needsReview: documents.filter(
      (document) =>
        document.pipelineStatus === "needs-review" || document.pipelineStatus === "unclassified",
    ).length,
    approved: documents.filter((document) => document.pipelineStatus === "trusted").length,
    all: documents.length,
  };
}

function filterDocuments(documents: DocumentListRow[], tab: DocumentsTab): DocumentListRow[] {
  if (tab === "needs-review") {
    return documents.filter(
      (document) =>
        document.pipelineStatus === "needs-review" || document.pipelineStatus === "unclassified",
    );
  }

  if (tab === "approved") {
    return documents.filter((document) => document.pipelineStatus === "trusted");
  }

  return documents;
}

function renderDocumentRow(row: DocumentListRow, now: Date): string {
  const typeLabel = row.documentTypeName ?? "Unclassified";

  return `<tr data-href="/documents/${escapeHtml(row.id)}" tabindex="0">
    <td>${entityCell(initialsFor(row.clientName), typeLabel, row.clientName)}</td>
    <td>${escapeHtml(formatRelativeTime(row.createdAt, now))}</td>
    <td>${escapeHtml(row.engagementLabel)}</td>
    <td>${pipelineChip(row.pipelineStatus)}</td>
  </tr>`;
}

function tableFooter(count: number): string {
  if (count === 0) {
    return "0 documents";
  }

  return `1–${count} of ${count} documents`;
}

function renderFilterBar(data: DocumentsData): string {
  const clientOptions: FilterOption[] = [
    { value: "", label: "All clients" },
    ...data.clients.map((client) => ({ value: client.id, label: client.legalName })),
  ];
  const yearOptions: FilterOption[] = [
    { value: "", label: "All years" },
    ...data.taxYears.map((year) => ({ value: String(year), label: String(year) })),
  ];
  const typeOptions: FilterOption[] = [
    { value: "", label: "All types" },
    ...data.documentTypes.map((type) => ({ value: type.id, label: type.name })),
  ];
  const sortOptions: FilterOption[] = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
  ];

  return filterBar(
    [
      filterSelect({ name: "client", label: "Client", options: clientOptions, selected: data.filters.client }),
      filterSelect({ name: "year", label: "Tax year", options: yearOptions, selected: data.filters.year }),
      filterSelect({ name: "type", label: "Document type", options: typeOptions, selected: data.filters.type }),
      filterSelect({ name: "sort", label: "Sort", options: sortOptions, selected: data.filters.sort }),
    ],
    hasActiveFilters(data.filters)
      ? documentsHref({ ...data.filters, client: "", year: "", type: "", sort: "newest" })
      : null,
  );
}

export function renderDocuments(data: DocumentsData): string {
  const counts = tabCounts(data.documents);
  const visible = filterDocuments(data.documents, data.filters.tab);
  const body =
    visible.length === 0 && hasActiveFilters(data.filters)
      ? emptyState("No documents match these filters")
      : dataTable(
          ["Document", "Date", "Engagement", "Status"],
          visible.map((row) => renderDocumentRow(row, data.now)),
          tableFooter(visible.length),
        );

  return `${pageHeader("Documents", String(counts.all))}
    ${tabs([
      {
        label: "Needs review",
        count: counts.needsReview,
        current: data.filters.tab === "needs-review",
        href: documentsHref(data.filters, "needs-review"),
      },
      {
        label: "Approved",
        count: counts.approved,
        current: data.filters.tab === "approved",
        href: documentsHref(data.filters, "approved"),
      },
      {
        label: "All",
        count: counts.all,
        current: data.filters.tab === "all",
        href: documentsHref(data.filters, "all"),
      },
    ])}
    ${renderFilterBar(data)}
    ${body}`;
}

export const documentsPage: PageModule<DocumentsData> = {
  async load() {
    const filters = parseDocumentsFilters(window.location.search);
    const [payload, clients, documentTypes, engagements] = await Promise.all([
      getJson(documentsApiUrl(filters), documentListResponseSchema),
      getJson("/api/clients", clientListResponseSchema),
      getJson("/api/document-types", documentTypesResponseSchema),
      // Tax-year options come from the engagements that actually exist.
      getJson("/api/engagements", engagementListResponseSchema),
    ]);
    const taxYears = [...new Set(engagements.engagements.map((row) => row.taxYear))].sort(
      (a, b) => b - a,
    );

    return {
      documents: payload.documents,
      filters,
      clients: clients.clients.map((client) => ({ id: client.id, legalName: client.legalName })),
      documentTypes: documentTypes.documentTypes.map((type) => ({ id: type.id, name: type.name })),
      taxYears,
      now: new Date(),
    };
  },
  render: renderDocuments,
  bind(root, data, repaint) {
    bindRowLinks(root, repaint);
    bindFilterBar(
      root,
      (name, value) => documentsHref(applyDocumentsFilter(data.filters, name, value)),
      repaint,
    );
  },
  pollMs: POLL_INTERVAL_MS,
};
