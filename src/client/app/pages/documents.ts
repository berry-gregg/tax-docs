import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  documentListResponseSchema,
  type DocumentListRow,
} from "../../../shared/schemas/api.ts";
import { getJson } from "../api.ts";
import { formatRelativeTime } from "../format.ts";
import {
  dataTable,
  entityCell,
  escapeHtml,
  initialsFor,
  pageHeader,
  pipelineChip,
  tabs,
  toolbar,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

export type DocumentsTab = "needs-review" | "approved" | "all";

export type DocumentsData = {
  documents: DocumentListRow[];
  tab: DocumentsTab;
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

  return `<tr data-href="/engagements/${escapeHtml(row.engagementId)}/review/${escapeHtml(row.id)}" tabindex="0">
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

export function renderDocuments(data: DocumentsData): string {
  const counts = tabCounts(data.documents);
  const visible = filterDocuments(data.documents, data.tab);

  return `${pageHeader("Documents", String(counts.all))}
    ${tabs([
      {
        label: "Needs review",
        count: counts.needsReview,
        current: data.tab === "needs-review",
        href: "/documents?tab=needs-review",
      },
      {
        label: "Approved",
        count: counts.approved,
        current: data.tab === "approved",
        href: "/documents?tab=approved",
      },
      {
        label: "All",
        count: counts.all,
        current: data.tab === "all",
        href: "/documents?tab=all",
      },
    ])}
    ${toolbar("Search documents…")}
    ${dataTable(
      ["Document", "Date", "Engagement", "Status"],
      visible.map((row) => renderDocumentRow(row, data.now)),
      tableFooter(visible.length),
    )}`;
}

function bindTableRows(root: HTMLElement, repaint: () => void): void {
  root.querySelectorAll<HTMLElement>("[data-href]").forEach((row) => {
    row.addEventListener("click", () => {
      const href = row.getAttribute("data-href");
      if (!href) {
        return;
      }

      window.history.pushState({}, "", href);
      repaint();
    });

    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        row.click();
      }
    });
  });
}

export const documentsPage: PageModule<DocumentsData> = {
  async load() {
    const tab = parseDocumentsTab(window.location.search);
    const payload = await getJson("/api/documents?group=all", documentListResponseSchema);

    return { documents: payload.documents, tab, now: new Date() };
  },
  render: renderDocuments,
  bind(root, _data, repaint) {
    bindTableRows(root, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
