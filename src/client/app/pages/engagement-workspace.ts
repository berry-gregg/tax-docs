import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  documentTypesResponseSchema,
  engagementDetailSchema,
  type EngagementDetail,
} from "../../../shared/schemas/api.ts";
import { taxDocumentSchema, type TaxDocument } from "../../../shared/schemas/document.ts";
import { type DocumentType } from "../../../shared/schemas/document-type.ts";
import type { RequestItem } from "../../../shared/schemas/request.ts";
import {
  validationCheckSchema,
  type ValidationCheck,
} from "../../../shared/schemas/validation.ts";
import { getJson, sendJson, uploadFile } from "../api.ts";
import { formatRelativeTime } from "../format.ts";
import {
  bindPortalLinkControls,
  bindRowLinks,
  breadcrumbs,
  confidenceChip,
  dataTable,
  emptyState,
  escapeHtml,
  pageHeader,
  pipelineChip,
  portalLinkControl,
  railWidget,
  stageChip,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

export type EngagementWorkspaceData = {
  detail: EngagementDetail;
  documentTypes: DocumentType[];
  validations: ValidationCheck[];
  now: Date;
};

const validationsResponseSchema = z.object({
  checks: z.array(validationCheckSchema),
});

const documentResponseSchema = z.object({
  document: taxDocumentSchema,
});

const itemUpdateResponseSchema = z.object({
  item: z.object({
    id: z.string().min(1),
  }),
});

const requestItemLabels: Record<RequestItem["status"], string> = {
  open: "Open",
  received: "Received",
  "needs-attention": "Needs attention",
  waived: "Waived",
};

const requestItemTones: Record<RequestItem["status"], "processing" | "warning" | "success" | "halted"> = {
  open: "processing",
  received: "success",
  "needs-attention": "warning",
  waived: "halted",
};

export function renderEngagementWorkspace(data: EngagementWorkspaceData): string {
  const { detail } = data;
  const trustedCount = detail.documents.filter((document) => document.pipelineStatus === "trusted").length;
  const actions = trustedCount > 0
    ? [{ href: `/engagements/${detail.engagement.id}/export`, label: "Export", kind: "primary" as const }]
    : [];

  return `<div class="page-home">
    <main>
      ${breadcrumbs([
        { label: "Engagements", href: "/engagements" },
        { label: detail.client.legalName },
      ])}
      ${pageHeader(detail.client.legalName, undefined, actions)}
      <p class="page-subtitle">${escapeHtml(`${detail.engagement.filingType} · ${detail.engagement.taxYear}`)}</p>
      ${renderStatusStrip(detail)}
      <section class="stack">
        <h2 class="section-title">Validation checks</h2>
        ${renderValidationSummary(data.validations)}
      </section>
      <section class="stack">
        <h2 class="section-title">Request checklist</h2>
        ${renderRequestChecklist(detail.engagement.id, detail.requestItems)}
      </section>
      <section class="stack" id="engagement-documents">
        <h2 class="section-title">Documents</h2>
        ${renderDropzone(detail.engagement.id)}
        <p class="load-error-message" data-workspace-error hidden></p>
        ${renderDocumentsTable(detail, data.documentTypes)}
      </section>
    </main>
    <aside class="rail">
      <h2 class="section-title">Activity</h2>
      ${renderActivity(detail, data.now)}
      ${railWidget(
        "Trusted documents",
        `${trustedCount} ready for export`,
        trustedCount > 0 ? `/engagements/${detail.engagement.id}/export` : "/documents?tab=approved",
      )}
      ${railWidget("Open requests", `${detail.requestItems.filter((item) => item.status === "open").length} still open`, "/inbox")}
    </aside>
  </div>`;
}

/**
 * One-line working status for the engagement: stage, checklist progress, review pressure,
 * trusted count, and the portal link. Live values from the loaded detail — never a metrics ticker.
 */
function renderStatusStrip(detail: EngagementDetail): string {
  const received = detail.requestItems.filter((item) => item.status === "received").length;
  const needsReview = detail.documents.filter(
    (document) => document.pipelineStatus === "needs-review",
  ).length;
  const trusted = detail.documents.filter(
    (document) => document.pipelineStatus === "trusted",
  ).length;
  const needsReviewLabel = `${needsReview === 1 ? "needs" : "need"} review`;
  const needsReviewItem =
    needsReview > 0
      ? `<a class="engagement-status-item engagement-status-link" href="#engagement-documents"><span class="engagement-status-value">${needsReview}</span> ${needsReviewLabel}</a>`
      : `<span class="engagement-status-item"><span class="engagement-status-value">0</span> need review</span>`;

  return `<div class="engagement-status" data-engagement-status>
    ${stageChip(detail.engagement.status)}
    <span class="engagement-status-item"><span class="engagement-status-value">${received} of ${detail.requestItems.length}</span> checklist items received</span>
    ${needsReviewItem}
    <span class="engagement-status-item"><span class="engagement-status-value">${trusted}</span> trusted</span>
    ${portalLinkControl(`/portal/${encodeURIComponent(detail.engagement.portalToken)}`)}
  </div>`;
}

function renderValidationSummary(checks: ValidationCheck[]): string {
  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warn");
  if (checks.length === 0) {
    return emptyState("Validation checks appear after documents enter review.");
  }

  return `<div class="row-list validation-list" aria-label="Validation checks">
    ${warnings
      .map(
        (check) =>
          `<div class="list-row">
            <span class="list-row-body">
              <span class="list-row-title">${escapeHtml(check.label)}</span>
              <span class="muted">${escapeHtml(check.explanation)}</span>
            </span>
            <span class="chip chip-warning">Warn</span>
          </div>`,
      )
      .join("")}
    <div class="list-row">
      <span class="muted">${passed} passed · Validation checks are advisory and never block review.</span>
    </div>
  </div>`;
}

function renderRequestChecklist(engagementId: string, items: RequestItem[]): string {
  if (items.length === 0) {
    return emptyState("No request items yet.");
  }

  return `<div class="row-list checklist-list">
    ${items
      .map(
        (item) =>
          `<div class="list-row">
            <span class="list-row-body">
              <span class="list-row-title">${escapeHtml(item.title)}</span>
              <span class="muted">${escapeHtml(item.description)}</span>
              ${
                item.status === "waived" && item.waiveNote
                  ? `<span class="muted checklist-waive-note">Waived — ${escapeHtml(item.waiveNote)}</span>`
                  : ""
              }
            </span>
            <span class="checklist-actions" data-request-item-id="${escapeHtml(item.id)}">${requestItemChip(item)}${checklistTrailing(engagementId, item)}</span>
          </div>`,
      )
      .join("")}
  </div>`;
}

/** Per-status trailing action: Waive for open optional items, View/Review for matched documents. */
function checklistTrailing(engagementId: string, item: RequestItem): string {
  if (item.status === "open" && !item.required) {
    return ` <button class="btn-ghost" type="button" data-waive-request-item="${escapeHtml(item.id)}">Waive</button>`;
  }

  const matchedId = item.matchedDocumentIds[0];
  if ((item.status === "received" || item.status === "needs-attention") && matchedId) {
    const href = `/documents/${encodeURIComponent(matchedId)}`;
    const label = item.status === "received" ? "View" : "Review";
    return ` <a class="checklist-doc-link" href="${escapeHtml(href)}" data-nav-link>${label}</a>`;
  }

  return "";
}

function requestItemChip(item: RequestItem): string {
  return `<span class="chip chip-${requestItemTones[item.status]}">${escapeHtml(
    requestItemLabels[item.status],
  )}</span>`;
}

function renderDropzone(engagementId: string): string {
  return `<label class="dropzone" data-dropzone data-engagement-id="${escapeHtml(engagementId)}">
    <span>Drop a PDF here</span>
    <span class="muted">or browse</span>
    <input class="visually-hidden-input" type="file" accept="application/pdf,.pdf" data-document-upload />
  </label>`;
}

function renderDocumentsTable(detail: EngagementDetail, documentTypes: DocumentType[]): string {
  if (detail.documents.length === 0) {
    return emptyState("Documents appear here as soon as the CPA or client uploads one.");
  }

  const typeById = new Map(documentTypes.map((type) => [type.id, type.name]));
  const rows = detail.documents.map((document) => {
    const documentTypeName = nameForDocument(document, typeById);
    const confidence = confidenceForDocument(document);
    const reviewHref = `/documents/${encodeURIComponent(document.id)}`;
    return `<tr data-href="${escapeHtml(reviewHref)}" tabindex="0">
      <td><a href="${escapeHtml(reviewHref)}" data-nav-link>${escapeHtml(document.filename)}</a>${renderFailure(document)}</td>
      <td>${escapeHtml(documentTypeName)}</td>
      <td>${pipelineChip(document.pipelineStatus)}</td>
      <td>${confidence}</td>
      <td>${escapeHtml(document.uploadedBy)}</td>
    </tr>`;
  });

  return dataTable(["Filename", "Type", "Pipeline", "Confidence", "Uploaded by"], rows, `1–${rows.length} of ${rows.length}`);
}

function nameForDocument(document: TaxDocument, typeById: Map<string, string>): string {
  const documentTypeId = document.classification?.documentTypeId;
  if (!documentTypeId) {
    return "Unclassified";
  }
  return typeById.get(documentTypeId) ?? "—";
}

function confidenceForDocument(document: TaxDocument): string {
  const confidence = document.classification?.confidence;
  if (confidence === undefined) {
    return "—";
  }
  return confidenceChip(confidence);
}

function renderFailure(document: TaxDocument): string {
  if (document.pipelineStatus !== "failed" || !document.failure) {
    return "";
  }

  return `<span class="muted">${escapeHtml(document.failure.message)}</span>
    <button class="btn-ghost" type="button" data-rerun-document-id="${escapeHtml(document.id)}">Retry</button>`;
}

function renderActivity(detail: EngagementDetail, now: Date): string {
  if (detail.activity.length === 0) {
    return emptyState("No activity yet.");
  }

  return `<div class="row-list activity-list">
    ${detail.activity
      .slice(0, 5)
      .map(
        (item) =>
          `<div class="list-row activity-row">
            <span class="muted activity-time">${escapeHtml(formatRelativeTime(item.createdAt, now))}</span>
            <span class="muted activity-text">${escapeHtml(item.action)} · ${escapeHtml(item.detail)}</span>
          </div>`,
      )
      .join("")}
  </div>`;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showError(root: HTMLElement, message: string): void {
  const slot = root.querySelector<HTMLElement>("[data-workspace-error]");
  if (!slot) {
    return;
  }

  slot.textContent = message;
  slot.hidden = false;
}

export const engagementPage: PageModule<EngagementWorkspaceData> = {
  async load(route) {
    const engagementId = route.page === "engagement" ? route.id : "";
    const [detail, documentTypes, validations] = await Promise.all([
      getJson(`/api/engagements/${encodeURIComponent(engagementId)}`, engagementDetailSchema),
      getJson("/api/document-types", documentTypesResponseSchema),
      getJson(`/api/engagements/${encodeURIComponent(engagementId)}/validations`, validationsResponseSchema),
    ]);
    return {
      detail,
      documentTypes: documentTypes.documentTypes,
      validations: validations.checks,
      now: new Date(),
    };
  },
  render: renderEngagementWorkspace,
  bind(root, data, repaint) {
    bindRowLinks(root, repaint);
    bindPortalLinkControls(root);

    const startUpload = (file: File) => {
      void uploadFile("/api/documents", file, { engagementId: data.detail.engagement.id }, documentResponseSchema)
        .then(() => repaint())
        .catch((error: unknown) => {
          showError(root, messageFor(error));
        });
    };

    root.querySelectorAll<HTMLElement>("[data-dropzone]").forEach((dropzone) => {
      const input = dropzone.querySelector<HTMLInputElement>("[data-document-upload]");
      input?.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        startUpload(file);
      });
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragover");
      });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));
      dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragover");
        const file = event.dataTransfer?.files[0];
        if (!file) return;
        startUpload(file);
      });
    });

    if (root.dataset.boundWorkspace) return;
    root.dataset.boundWorkspace = "true";

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const itemId = target.getAttribute("data-waive-request-item");
      if (itemId) {
        void sendJson(
          "PATCH",
          `/api/engagements/${encodeURIComponent(data.detail.engagement.id)}/request-items/${encodeURIComponent(itemId)}`,
          { status: "waived" },
          itemUpdateResponseSchema,
        )
          .then(() => repaint())
          .catch((error: unknown) => {
            showError(root, messageFor(error));
          });
      }

      const documentId = target.getAttribute("data-rerun-document-id");
      if (documentId) {
        void sendJson(
          "POST",
          `/api/documents/${encodeURIComponent(documentId)}/rerun`,
          {},
          documentResponseSchema,
        )
          .then(() => repaint())
          .catch((error: unknown) => {
            showError(root, messageFor(error));
          });
      }
    });
  },
  pollMs: POLL_INTERVAL_MS,
};
