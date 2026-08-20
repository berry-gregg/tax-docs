import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  engagementDetailSchema,
  type EngagementDetail,
} from "../../../shared/schemas/api.ts";
import { taxDocumentSchema, type TaxDocument } from "../../../shared/schemas/document.ts";
import { documentTypeSchema, type DocumentType } from "../../../shared/schemas/document-type.ts";
import type { RequestItem } from "../../../shared/schemas/request.ts";
import {
  validationCheckSchema,
  type ValidationCheck,
} from "../../../shared/schemas/validation.ts";
import { getJson, sendJson, uploadFile } from "../api.ts";
import { formatConfidence, formatRelativeTime } from "../format.ts";
import {
  dataTable,
  emptyState,
  escapeHtml,
  listRow,
  pageHeader,
  pipelineChip,
  railWidget,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

export type EngagementWorkspaceData = {
  detail: EngagementDetail;
  documentTypes: DocumentType[];
  validations: ValidationCheck[];
  now: Date;
};

const documentTypesResponseSchema = z.object({
  documentTypes: z.array(documentTypeSchema),
});

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
      ${pageHeader(detail.client.legalName, `${detail.engagement.filingType} · ${detail.engagement.taxYear}`, actions)}
      <div class="page-actions">
        <a class="btn-secondary" href="/portal/${encodeURIComponent(detail.engagement.portalToken)}" data-nav-link>Open portal</a>
        <button class="btn-ghost" type="button" data-copy-portal-link="/portal/${encodeURIComponent(
          detail.engagement.portalToken,
        )}">Copy portal link</button>
        ${stageChip(detail.engagement.status)}
      </div>
      ${renderValidationSummary(data.validations)}
      <section class="stack">
        <h2 class="section-title">Request checklist</h2>
        ${renderRequestChecklist(detail.requestItems)}
      </section>
      <section class="stack">
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

function stageChip(status: EngagementDetail["engagement"]["status"]): string {
  const labels: Record<EngagementDetail["engagement"]["status"], string> = {
    draft: "Draft",
    collecting: "Collecting",
    "in-review": "In review",
    "ready-to-export": "Ready to export",
    exported: "Exported",
  };
  const tones: Record<EngagementDetail["engagement"]["status"], "processing" | "warning" | "success"> = {
    draft: "processing",
    collecting: "processing",
    "in-review": "warning",
    "ready-to-export": "success",
    exported: "success",
  };
  return `<span class="chip chip-${tones[status]}">${escapeHtml(labels[status])}</span>`;
}

function renderValidationSummary(checks: ValidationCheck[]): string {
  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warn");
  if (checks.length === 0) {
    return emptyState("Validation checks appear after documents enter review.");
  }

  return `<div class="row-list" aria-label="Validation summary">
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
      <span class="list-row-body">
        <span class="list-row-title">${passed} passed</span>
        <span class="muted">Validation checks are advisory and never block review.</span>
      </span>
      <span class="chip chip-success">Pass</span>
    </div>
  </div>`;
}

function renderRequestChecklist(items: RequestItem[]): string {
  if (items.length === 0) {
    return emptyState("No request items yet.");
  }

  return `<div class="row-list">
    ${items
      .map(
        (item) =>
          `<div class="list-row">
            <span class="list-row-body">
              <span class="list-row-title">${escapeHtml(item.title)}</span>
              <span class="muted">${escapeHtml(item.description)}</span>
            </span>
            <span data-request-item-id="${escapeHtml(item.id)}">${requestItemChip(item)}${
              item.status === "open" && !item.required
                ? ` <button class="btn-ghost" type="button" data-waive-request-item="${escapeHtml(item.id)}">Waive</button>`
                : ""
            }</span>
          </div>`,
      )
      .join("")}
  </div>`;
}

function requestItemChip(item: RequestItem): string {
  return `<span class="chip chip-${requestItemTones[item.status]}">${escapeHtml(
    requestItemLabels[item.status],
  )}</span>`;
}

function renderDropzone(engagementId: string): string {
  return `<label class="dropzone" data-dropzone data-engagement-id="${escapeHtml(engagementId)}">
    <span>Drop a PDF here</span>
    <span class="muted">or choose a file to upload into this engagement</span>
    <input type="file" accept="application/pdf,.pdf" data-document-upload />
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
    const reviewHref = `/engagements/${encodeURIComponent(detail.engagement.id)}/review/${encodeURIComponent(
      document.id,
    )}`;
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
  const formatted = formatConfidence(confidence);
  return `<span class="confidence confidence-${formatted.tier}">${formatted.pct}</span>`;
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

  return `<div class="row-list">
    ${detail.activity
      .slice(0, 5)
      .map((item) =>
        listRow({
          href: `/engagements/${detail.engagement.id}`,
          title: item.action,
          meta: `${formatRelativeTime(item.createdAt, now)} · ${item.detail}`,
        }),
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

function bindTableRows(root: HTMLElement, repaint: () => void): void {
  root.querySelectorAll<HTMLElement>("[data-href]").forEach((row) => {
    row.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("a,button,input,label")) {
        return;
      }

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
    bindTableRows(root, repaint);

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

      const portalHref = target.getAttribute("data-copy-portal-link");
      if (portalHref) {
        void navigator.clipboard?.writeText(new URL(portalHref, window.location.origin).toString());
      }
    });
  },
  pollMs: POLL_INTERVAL_MS,
};
