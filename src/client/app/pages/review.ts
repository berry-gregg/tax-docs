import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  taxDocumentSchema,
  type ExtractionField,
  type TaxDocument,
} from "../../../shared/schemas/document.ts";
import {
  createDocumentTypeInputSchema,
  documentTypeSchema,
  type CreateDocumentTypeInput,
  type DocumentType,
} from "../../../shared/schemas/document-type.ts";
import type { DataType } from "../../../shared/schemas/metadata.ts";
import {
  validationCheckSchema,
  type ValidationCheck,
} from "../../../shared/schemas/validation.ts";
import { ApiError, getJson, sendJson } from "../api.ts";
import { bindSchemaBuilder, renderSchemaBuilder } from "../components/schema-builder.ts";
import { formatConfidence, formatMoney } from "../format.ts";
import { emptyState, escapeHtml, pageHeader, pipelineChip } from "../render.ts";
import type { Route } from "../router.ts";
import type { PageModule } from "./registry.ts";

export type ReviewData = {
  engagementId: string;
  document: TaxDocument;
  documentType: DocumentType | null;
  validations: ValidationCheck[];
};

type FieldValue = string | number | boolean | null;

const documentDetailResponseSchema = z.object({
  document: taxDocumentSchema,
  documentType: documentTypeSchema.optional(),
});

const documentResponseSchema = z.object({ document: taxDocumentSchema });

const documentTypeResponseSchema = z.object({ documentType: documentTypeSchema });

/**
 * `active` carries a Zod default in the create schema, which makes it optional on the way in. The
 * draft endpoint always sends it, so the wire shape pins it as required and the parsed draft can
 * feed the schema builder directly.
 */
const draftTypeResponseSchema = z.object({
  draft: createDocumentTypeInputSchema.extend({ active: z.boolean() }),
});

const validationsResponseSchema = z.object({ checks: z.array(validationCheckSchema) });

/**
 * A resolved field earns a mark; an unresolved one carries the Accept/Edit pair instead. Chipping
 * every untouched row would spend the warning colour on the default state.
 */
const reviewStatusChips: Record<ExtractionField["reviewStatus"], string> = {
  unreviewed: "",
  accepted: '<span class="chip chip-success">Accepted</span>',
  edited: '<span class="chip chip-success">Edited</span>',
};

/**
 * The trust gate, mirroring the server's own rule in `POST /api/documents/:id/trust`: a field the
 * reviewer never touched blocks the write, and an empty extraction is not vacuously trusted.
 * Keeping the two in step means the button is never enabled for a request the API would reject,
 * and never disabled for one it would accept.
 */
export function canTrust(fields: ExtractionField[]): boolean {
  return fields.length > 0 && fields.every((field) => field.reviewStatus !== "unreviewed");
}

/** `formatConfidence` owns the 90% boundary, so the bulk-accept control reuses its tier. */
function isHighConfidence(field: ExtractionField): boolean {
  return formatConfidence(field.confidence).tier === "high";
}

/** Ungrounded gaps stay unreviewed — a high confidence on a null value is not an accept. */
export function bulkAcceptKeys(fields: ExtractionField[]): string[] {
  return fields
    .filter((field) => field.reviewStatus === "unreviewed" && !field.notFound && isHighConfidence(field))
    .map((field) => field.key);
}

function effectiveValue(field: ExtractionField): FieldValue {
  return field.editedValue ?? field.value;
}

/** A value we could not ground says so. Formatting a guess would be a confident invention. */
function displayValue(field: ExtractionField, value: FieldValue): string {
  if (value === null) {
    return "Not found";
  }

  if (typeof value === "number" && (field.metadataType === "dollar-amount" || field.metadataType === "total")) {
    return formatMoney(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function renderFieldValue(field: ExtractionField): string {
  const value = effectiveValue(field);
  if (field.notFound && field.reviewStatus !== "edited") {
    return `<p class="review-field-value muted">Not found</p>`;
  }

  return `<p class="review-field-value">${escapeHtml(displayValue(field, value))}</p>`;
}

/** An edit never erases what the model read — the reviewer's correction sits beside the source. */
function renderEditedNote(field: ExtractionField): string {
  if (field.reviewStatus !== "edited" || field.editedValue === undefined) {
    return "";
  }

  return `<p class="review-field-note">Extracted ${escapeHtml(displayValue(field, field.value))}</p>`;
}

function renderSourceSnippet(field: ExtractionField): string {
  if (field.sourceSnippet.length === 0) {
    return `<p class="review-field-note">No source snippet was returned for this field.</p>`;
  }

  return `<blockquote class="review-source">${escapeHtml(field.sourceSnippet)}</blockquote>`;
}

/** Native input types do the parsing, so the client never forks the pipeline's coercion rules. */
function editControl(field: ExtractionField): string {
  const current = effectiveValue(field);

  if (field.dataType === "boolean") {
    const truthy = current === true;
    return `<select data-field-edit-input>
      <option value="true" ${truthy ? "selected" : ""}>Yes</option>
      <option value="false" ${truthy ? "" : "selected"}>No</option>
    </select>`;
  }

  const type =
    field.dataType === "date"
      ? 'type="date"'
      : field.dataType === "int"
        ? 'type="number" step="1"'
        : field.dataType === "double"
          ? 'type="number" step="any"'
          : 'type="text"';

  return `<input ${type} data-field-edit-input value="${escapeHtml(current === null ? "" : String(current))}" />`;
}

function renderFieldRow(field: ExtractionField, interactive: boolean): string {
  const confidence = formatConfidence(field.confidence);
  const key = escapeHtml(field.key);

  return `<article class="review-field" data-field-row="${key}">
    <div class="review-field-head">
      <span class="review-field-label">${escapeHtml(field.label)}</span>
      <span class="review-field-type">${escapeHtml(field.metadataType)}</span>
      <span class="confidence confidence-${confidence.tier}">${confidence.pct}</span>
      ${reviewStatusChips[field.reviewStatus]}
      ${field.regexPass === false ? '<span class="chip chip-warning">Format mismatch</span>' : ""}
    </div>
    ${renderFieldValue(field)}
    ${renderEditedNote(field)}
    ${renderSourceSnippet(field)}
    ${
      interactive
        ? `<div class="review-field-actions">
            <button class="btn-ghost" type="button" data-accept-field="${key}">Accept</button>
            <button class="btn-ghost" type="button" data-edit-field="${key}">Edit</button>
          </div>
          <form class="review-field-edit" data-field-edit="${key}" hidden>
            <label class="form-field">
              <span>Corrected value</span>
              ${editControl(field)}
            </label>
            <div class="review-field-actions">
              <button class="btn-secondary" type="submit">Save</button>
              <button class="btn-ghost" type="button" data-field-edit-cancel>Cancel</button>
            </div>
          </form>`
        : ""
    }
  </article>`;
}

function renderValidationWarnings(checks: ValidationCheck[]): string {
  const warnings = checks.filter((check) => check.status === "warn");

  if (warnings.length === 0) {
    return `<section class="stack" aria-label="Validation">
      <h3 class="section-title">Validation</h3>
      <p class="muted">No warnings on this engagement. Checks are advisory and never block review.</p>
    </section>`;
  }

  return `<section class="stack" aria-label="Validation warnings">
    <h3 class="section-title">Validation warnings</h3>
    <div class="row-list">
      ${warnings
        .map(
          (check) => `<div class="list-row">
            <span class="avatar-spacer" aria-hidden="true"></span>
            <span class="list-row-body">
              <span class="list-row-title">${escapeHtml(check.label)}</span>
              <span class="muted">${escapeHtml(check.explanation)}</span>
            </span>
            <span class="chip chip-warning">Warn</span>
          </div>`,
        )
        .join("")}
    </div>
    <p class="muted">Warnings are advisory — they never block review or export.</p>
  </section>`;
}

function renderFieldsVariant(data: ReviewData, fields: ExtractionField[]): string {
  const interactive = data.document.pipelineStatus === "needs-review";
  const reviewed = fields.filter((field) => field.reviewStatus !== "unreviewed").length;
  const bulkKeys = bulkAcceptKeys(fields);

  return `<div class="review-actions">
      <span class="muted">${reviewed} of ${fields.length} fields reviewed</span>
      ${
        interactive && bulkKeys.length > 0
          ? `<button class="btn-secondary" type="button" data-accept-high-confidence>Accept all ≥90%</button>`
          : ""
      }
    </div>
    ${
      fields.length === 0
        ? emptyState("Extraction returned no fields for this document type.")
        : `<div class="review-fields">${fields.map((field) => renderFieldRow(field, interactive)).join("")}</div>`
    }
    ${renderValidationWarnings(data.validations)}
    ${interactive ? renderTrustFooter(fields) : renderTrustedFooter(data)}`;
}

function trustFooterCopy(fields: ExtractionField[], ready: boolean): string {
  if (fields.length === 0) {
    return "Extraction returned no fields. This document cannot be marked trusted.";
  }

  return ready
    ? "Every field is resolved. Marking trusted is the human confirmation step."
    : "Accept or edit every field before this document can be trusted.";
}

function renderTrustFooter(fields: ExtractionField[]): string {
  const ready = canTrust(fields);

  return `<footer class="review-foot">
    <span class="muted">${trustFooterCopy(fields, ready)}</span>
    <button class="btn-primary" type="button" data-mark-trusted${ready ? "" : " disabled"}>Mark trusted</button>
  </footer>`;
}

function renderTrustedFooter(data: ReviewData): string {
  return `<footer class="review-foot">
    <span class="muted">Trusted. These values are ready for the engine export.</span>
    <a class="btn-secondary" href="/engagements/${encodeURIComponent(data.engagementId)}/export" data-nav-link>Open export</a>
  </footer>`;
}

function renderUnclassifiedVariant(): string {
  return `<div class="review-variant">
    <p>No active document type matched this upload, so extraction did not run. Define the type and the document re-runs against it.</p>
    <button class="btn-primary" type="button" data-define-document-type>Define document type</button>
    <div data-schema-panel-slot></div>
  </div>`;
}

function renderFailedVariant(document: TaxDocument): string {
  const message = document.failure?.message ?? "The pipeline failed without recording a cause.";

  return `<div class="review-variant">
    <p class="load-error-message">${escapeHtml(message)}</p>
    <button class="btn-secondary" type="button" data-rerun-document>Retry</button>
  </div>`;
}

function renderRejectedVariant(document: TaxDocument): string {
  const rejection = document.rejection;

  return `<div class="review-variant">
    <p>Quality review rejected this upload as ${escapeHtml(rejection?.kind ?? "unreadable")}.</p>
    <p class="muted">${escapeHtml(rejection?.reason ?? "No reason was recorded.")}</p>
    <button class="btn-secondary" type="button" data-rerun-document>Run again</button>
  </div>`;
}

function renderProcessingVariant(): string {
  return `<div class="review-variant">
    <p class="muted">This document is still moving through the pipeline. The page updates on its own.</p>
  </div>`;
}

function renderPanelHead(data: ReviewData, typeName: string): string {
  const classification = data.document.classification;
  const confidence = classification ? formatConfidence(classification.confidence) : null;

  return `<header class="review-panel-head">
    <div class="review-panel-title">
      <h2 class="section-title">${escapeHtml(typeName)}</h2>
      ${pipelineChip(data.document.pipelineStatus)}
      ${confidence ? `<span class="confidence confidence-${confidence.tier}">${confidence.pct}</span>` : ""}
    </div>
    <p class="muted">${escapeHtml(classification?.reasoning ?? "Classification has not run for this document yet.")}</p>
    <p class="load-error-message" data-review-error hidden></p>
  </header>`;
}

function renderVariant(data: ReviewData): string {
  switch (data.document.pipelineStatus) {
    case "needs-review":
    case "trusted":
      return renderFieldsVariant(data, data.document.extraction?.fields ?? []);
    case "unclassified":
      return renderUnclassifiedVariant();
    case "failed":
      return renderFailedVariant(data.document);
    case "rejected":
      return renderRejectedVariant(data.document);
    case "received":
    case "quality-review":
    case "classifying":
    case "extracting":
      return renderProcessingVariant();
  }
}

export function renderReview(data: ReviewData): string {
  const typeName = data.documentType?.name ?? "Unclassified";
  const fileHref = `/api/documents/${encodeURIComponent(data.document.id)}/file`;

  return `<div class="review-page" data-review-document="${escapeHtml(data.document.id)}">
    ${pageHeader(data.document.filename, typeName, [
      {
        href: `/engagements/${encodeURIComponent(data.engagementId)}`,
        label: "Back to engagement",
        kind: "secondary",
      },
    ])}
    <div class="review-split">
      <section class="review-viewer" aria-label="Document preview">
        <iframe class="review-frame" src="${fileHref}" title="${escapeHtml(data.document.filename)}"></iframe>
      </section>
      <section class="review-panel" aria-label="Extracted data">
        ${renderPanelHead(data, typeName)}
        ${renderVariant(data)}
      </section>
    </div>
  </div>`;
}

function assertReviewRoute(route: Route): asserts route is Extract<Route, { page: "review" }> {
  if (route.page !== "review") {
    throw new Error("Review page loaded for a non-review route");
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showError(root: HTMLElement, message: string): void {
  const slot = root.querySelector<HTMLElement>("[data-review-error]");
  if (!slot) {
    return;
  }

  slot.textContent = message;
  slot.hidden = false;
}

function readEditedValue(
  control: HTMLInputElement | HTMLSelectElement,
  dataType: DataType,
): string | number | boolean {
  if (dataType === "boolean") {
    return control.value === "true";
  }

  if (dataType === "int" || dataType === "double") {
    const parsed = control instanceof HTMLInputElement ? control.valueAsNumber : Number(control.value);
    return Number.isFinite(parsed) ? parsed : control.value;
  }

  return control.value;
}

function fieldPath(documentId: string, key: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/fields/${encodeURIComponent(key)}`;
}

async function acceptField(documentId: string, key: string): Promise<void> {
  await sendJson("PATCH", fieldPath(documentId, key), { action: "accept" }, documentResponseSchema);
}

function bindFieldActions(root: HTMLElement, data: ReviewData, repaint: () => void): void {
  const documentId = data.document.id;
  const fields = data.document.extraction?.fields ?? [];

  root.querySelectorAll<HTMLButtonElement>("[data-accept-field]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.acceptField;
      if (!key) {
        return;
      }

      void acceptField(documentId, key).then(repaint, (error: unknown) => {
        showError(root, messageFor(error));
      });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-edit-field]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.editField;
      const form = key ? root.querySelector<HTMLElement>(`[data-field-edit="${key}"]`) : null;
      if (!form) {
        return;
      }

      form.hidden = false;
      form.querySelector<HTMLElement>("[data-field-edit-input]")?.focus();
    });
  });

  root.querySelectorAll<HTMLFormElement>("[data-field-edit]").forEach((form) => {
    form.querySelector<HTMLButtonElement>("[data-field-edit-cancel]")?.addEventListener("click", () => {
      form.hidden = true;
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const key = form.dataset.fieldEdit;
      const control = form.querySelector<HTMLInputElement | HTMLSelectElement>("[data-field-edit-input]");
      const field = fields.find((entry) => entry.key === key);
      if (!key || !control || !field) {
        return;
      }

      void sendJson(
        "PATCH",
        fieldPath(documentId, key),
        { action: "edit", value: readEditedValue(control, field.dataType) },
        documentResponseSchema,
      ).then(repaint, (error: unknown) => {
        showError(root, messageFor(error));
      });
    });
  });

  root.querySelector<HTMLButtonElement>("[data-accept-high-confidence]")?.addEventListener("click", () => {
    void (async () => {
      for (const key of bulkAcceptKeys(fields)) {
        await acceptField(documentId, key);
      }
      repaint();
    })().catch((error: unknown) => {
      showError(root, messageFor(error));
    });
  });
}

function bindTrust(root: HTMLElement, data: ReviewData, repaint: () => void): void {
  const button = root.querySelector<HTMLButtonElement>("[data-mark-trusted]");
  button?.addEventListener("click", () => {
    void sendJson(
      "POST",
      `/api/documents/${encodeURIComponent(data.document.id)}/trust`,
      {},
      documentResponseSchema,
    ).then(
      () => {
        window.history.pushState({}, "", `/engagements/${encodeURIComponent(data.engagementId)}`);
        repaint();
      },
      (error: unknown) => {
        showError(root, messageFor(error));
      },
    );
  });
}

function bindRerun(root: HTMLElement, data: ReviewData, repaint: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-rerun-document]").forEach((button) => {
    button.addEventListener("click", () => {
      void sendJson(
        "POST",
        `/api/documents/${encodeURIComponent(data.document.id)}/rerun`,
        {},
        documentResponseSchema,
      ).then(repaint, (error: unknown) => {
        showError(root, messageFor(error));
      });
    });
  });
}

/**
 * The fail-soft loop: the model drafts a schema, a person edits and saves it, and the originating
 * document re-runs against the type they just created. Polling picks the document up from there.
 */
function bindDefineDocumentType(root: HTMLElement, data: ReviewData, repaint: () => void): void {
  const button = root.querySelector<HTMLButtonElement>("[data-define-document-type]");
  const slot = root.querySelector<HTMLElement>("[data-schema-panel-slot]");
  if (!button || !slot) {
    return;
  }

  button.addEventListener("click", () => {
    if (slot.querySelector(".side-panel")) {
      return;
    }

    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Drafting schema…";

    void sendJson(
      "POST",
      `/api/documents/${encodeURIComponent(data.document.id)}/draft-type`,
      {},
      draftTypeResponseSchema,
    ).then(
      (payload) => {
        button.disabled = false;
        button.textContent = label;
        openSchemaBuilder(root, slot, data, payload.draft, repaint);
      },
      (error: unknown) => {
        button.disabled = false;
        button.textContent = label;
        showError(root, messageFor(error));
      },
    );
  });
}

function openSchemaBuilder(
  root: HTMLElement,
  slot: HTMLElement,
  data: ReviewData,
  draft: CreateDocumentTypeInput,
  repaint: () => void,
): void {
  if (slot.querySelector(".side-panel")) {
    return;
  }

  slot.innerHTML = `<div class="modal" data-schema-scrim aria-hidden="true"></div>${renderSchemaBuilder(draft)}`;
  const panel = slot.querySelector<HTMLElement>(".side-panel");
  if (!panel) {
    return;
  }

  bindSchemaBuilder(panel, {
    onClose() {
      slot.innerHTML = "";
    },
    onSave(input) {
      void (async () => {
        await sendJson("POST", "/api/document-types", input, documentTypeResponseSchema);
        await sendJson(
          "POST",
          `/api/documents/${encodeURIComponent(data.document.id)}/rerun`,
          {},
          documentResponseSchema,
        );
        slot.innerHTML = "";
        repaint();
      })().catch((error: unknown) => {
        showError(root, messageFor(error));
      });
    },
  });
}

export const reviewPage: PageModule<ReviewData> = {
  async load(route) {
    assertReviewRoute(route);

    const [detail, validations] = await Promise.all([
      getJson(`/api/documents/${encodeURIComponent(route.documentId)}`, documentDetailResponseSchema),
      getJson(
        `/api/engagements/${encodeURIComponent(route.engagementId)}/validations`,
        validationsResponseSchema,
      ),
    ]);

    // A deep link that pairs a document with someone else's engagement is a miss, not a 403.
    if (detail.document.engagementId !== route.engagementId) {
      throw new ApiError(404, "Not found");
    }

    return {
      engagementId: route.engagementId,
      document: detail.document,
      documentType: detail.documentType ?? null,
      validations: validations.checks,
    };
  },
  render: renderReview,
  bind(root, data, repaint) {
    bindFieldActions(root, data, repaint);
    bindTrust(root, data, repaint);
    bindRerun(root, data, repaint);
    bindDefineDocumentType(root, data, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
