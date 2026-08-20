import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  engagementListResponseSchema,
  type EngagementListRow,
} from "../../../shared/schemas/api.ts";
import { getJson } from "../api.ts";
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

export type EngagementsData = {
  engagements: EngagementListRow[];
  showNewEngagementModal?: boolean;
  newEngagement?: NewEngagementModalState;
};

export function renderEngagements(data: EngagementsData): string {
  const rows = data.engagements.map(renderEngagementRow);
  const modal = data.showNewEngagementModal
    ? renderNewEngagementModal(
        data.newEngagement ?? initialNewEngagementState({ clients: [], documentTypes: [] }),
      )
    : "";

  return `<section>
    ${pageHeader("Engagements", String(data.engagements.length), [
      { href: "/engagements?new=1", label: "New engagement", kind: "primary" },
    ])}
    ${
      rows.length === 0
        ? emptyState("No engagements yet. Create one to request client documents.")
        : dataTable(
            ["Client", "Filing type", "Tax year", "Stage", "Docs progress", "Needs review"],
            rows,
            `1–${rows.length} of ${rows.length}`,
          )
    }
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
    const [engagements, modalState] = await Promise.all([
      getJson("/api/engagements", engagementListResponseSchema),
      (async () => {
        const requested = modalRequested();
        if (!requested.show) {
          clearNewEngagementDraft();
          return undefined;
        }
        return loadNewEngagementState(requested.clientId, requested.filingType ?? "1120-S");
      })(),
    ]);
    return {
      engagements: engagements.engagements,
      showNewEngagementModal: modalState !== undefined,
      newEngagement: modalState,
    };
  },
  render: renderEngagements,
  bind(root, data, repaint) {
    bindRowLinks(root, repaint);
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
