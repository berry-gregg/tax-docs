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
import { getJson, sendJson } from "../api.ts";
import { bindSchemaBuilder, renderSchemaBuilder } from "../components/schema-builder.ts";
import { formatMoney } from "../format.ts";
import {
  breadcrumbs,
  confidenceChip,
  emptyState,
  escapeHtml,
  pageHeader,
  pipelineChip,
} from "../render.ts";
import type { Route } from "../router.ts";
import type { PageModule } from "./registry.ts";

export type ReviewData = {
  /** Derived from the document itself — the route only carries the document id. */
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
 * The trust gate, mirroring the server's rule in `POST /api/documents/:id/trust`: an empty
 * extraction is not vacuously trusted, but per-field review is no longer required — trusting the
 * document is the review, and the server finalizes untouched fields as accepted.
 */
export function canTrust(fields: ExtractionField[]): boolean {
  return fields.length > 0;
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

/**
 * Native input types do the parsing, so the client never forks the pipeline's coercion rules.
 * The value rests in a real input — editable by default, no edit mode to enter.
 */
function fieldInput(field: ExtractionField, interactive: boolean): string {
  const key = escapeHtml(field.key);
  const disabled = interactive ? "" : " disabled";
  const current = effectiveValue(field);

  if (field.dataType === "boolean") {
    const truthy = current === true;
    return `<select class="review-field-input" data-field-input="${key}"${disabled}>
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
  const placeholder =
    field.notFound && field.reviewStatus !== "edited" ? ' placeholder="Not found"' : "";

  return `<input class="review-field-input" ${type} data-field-input="${key}" value="${escapeHtml(
    current === null ? "" : String(current),
  )}"${placeholder}${disabled} />`;
}

/**
 * The quiet per-row status slot: shows the edit attribution at rest (with the model's original
 * value preserved in the tooltip) and the saving/saved/error hint while a change is in flight.
 */
function fieldStateSlot(field: ExtractionField): string {
  const key = escapeHtml(field.key);
  if (field.reviewStatus === "edited") {
    const original = escapeHtml(`Extracted ${displayValue(field, field.value)}`);
    return `<span class="review-field-state" data-field-state="${key}" title="${original}">Edited</span>`;
  }

  return `<span class="review-field-state" data-field-state="${key}"></span>`;
}

/** Source snippets are one disclosure away instead of a permanent quote block per row. */
function sourceDisclosure(field: ExtractionField): string {
  if (field.sourceSnippet.length === 0) {
    return "";
  }

  const key = escapeHtml(field.key);
  return `<button class="review-source-toggle" type="button" data-source-toggle="${key}" aria-expanded="false">Source</button>`;
}

function sourceRow(field: ExtractionField): string {
  if (field.sourceSnippet.length === 0) {
    return "";
  }

  const key = escapeHtml(field.key);
  return `<blockquote class="review-source" data-source-row="${key}" hidden>${escapeHtml(field.sourceSnippet)}</blockquote>`;
}

/** One compact hairline row: name · always-editable value · confidence. Nothing stacked. */
function renderFieldRow(field: ExtractionField, interactive: boolean): string {
  const key = escapeHtml(field.key);

  return `<article class="review-field" data-field-row="${key}">
    <span class="review-field-name">
      <span class="review-field-label">${escapeHtml(field.label)}</span>
      <span class="review-field-type">${escapeHtml(field.metadataType)}</span>
    </span>
    <span class="review-field-control">
      ${fieldInput(field, interactive)}
      ${field.regexPass === false ? '<span class="chip chip-warning">Format mismatch</span>' : ""}
    </span>
    <span class="review-field-meta">
      ${confidenceChip(field.confidence)}
      ${fieldStateSlot(field)}
      ${sourceDisclosure(field)}
    </span>
    ${sourceRow(field)}
  </article>`;
}

/**
 * Document-scoped quality checks only: a check renders here when its `relatedDocumentIds`
 * includes this document. Passes stay visible — a green "Balance sheet ties" is a feature.
 * Cross-document noise and the checklist roll-up live on the engagement workspace.
 */
function renderValidationChecks(checks: ValidationCheck[], documentId: string): string {
  const relevant = checks.filter((check) => check.relatedDocumentIds.includes(documentId));

  if (relevant.length === 0) {
    return `<section class="stack" aria-label="Validation">
      <h3 class="section-title">Validation</h3>
      <p class="muted">No document-level checks for this document type.</p>
    </section>`;
  }

  return `<section class="stack" aria-label="Validation">
    <h3 class="section-title">Validation</h3>
    <div class="row-list">
      ${relevant
        .map(
          (check) => `<div class="list-row">
            <span class="avatar-spacer" aria-hidden="true"></span>
            <span class="list-row-body">
              <span class="list-row-title">${escapeHtml(check.label)}</span>
              <span class="muted">${escapeHtml(check.explanation)}</span>
            </span>
            ${
              check.status === "pass"
                ? '<span class="chip chip-success">Pass</span>'
                : '<span class="chip chip-warning">Warn</span>'
            }
          </div>`,
        )
        .join("")}
    </div>
    <p class="muted">Checks are advisory — they never block review or export.</p>
  </section>`;
}

function renderFieldsVariant(data: ReviewData, fields: ExtractionField[]): string {
  const interactive = data.document.pipelineStatus === "needs-review";

  return `${
    fields.length === 0
      ? emptyState("Extraction returned no fields for this document type.")
      : `<div class="review-fields">${fields.map((field) => renderFieldRow(field, interactive)).join("")}</div>`
  }
    ${renderValidationChecks(data.validations, data.document.id)}
    ${interactive ? renderTrustFooter(fields) : renderTrustedFooter(data)}`;
}

function trustFooterCopy(fields: ExtractionField[]): string {
  if (fields.length === 0) {
    return "Extraction returned no fields. This document cannot be marked trusted.";
  }

  return "Edit anything that is wrong, then mark trusted — the human confirmation step. Unedited values are accepted as extracted.";
}

function renderTrustFooter(fields: ExtractionField[]): string {
  const ready = canTrust(fields);

  return `<footer class="review-foot">
    <span class="muted">${trustFooterCopy(fields)}</span>
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

  return `<header class="review-panel-head">
    <div class="review-panel-title">
      <h2 class="section-title">${escapeHtml(typeName)}</h2>
      ${pipelineChip(data.document.pipelineStatus)}
      ${classification ? confidenceChip(classification.confidence) : ""}
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
    ${breadcrumbs([{ label: "Documents", href: "/documents" }, { label: data.document.filename }])}
    ${pageHeader(data.document.filename, typeName, [
      {
        href: `/engagements/${encodeURIComponent(data.engagementId)}`,
        label: "Engagement workspace",
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

/**
 * Number parsing avoids `valueAsNumber`/`instanceof` so the same code runs against fakes in
 * tests. An empty numeric input stays a string — silently coercing it to 0 would invent a value.
 */
function readEditedValue(
  control: { value: string },
  dataType: DataType,
): string | number | boolean {
  if (dataType === "boolean") {
    return control.value === "true";
  }

  if (dataType === "int" || dataType === "double") {
    if (control.value.trim() === "") {
      return control.value;
    }
    const parsed = Number(control.value);
    return Number.isFinite(parsed) ? parsed : control.value;
  }

  return control.value;
}

function fieldPath(documentId: string, key: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/fields/${encodeURIComponent(key)}`;
}

/**
 * Save-on-change: values live in real inputs, so leaving a changed input persists the edit.
 * `change` only fires after user modification, which is the debounce — no timers needed. The
 * in-memory field updates on success so a repeat blur with the same value is a no-op.
 */
function bindFieldInputs(root: HTMLElement, data: ReviewData): void {
  const documentId = data.document.id;
  const fields = data.document.extraction?.fields ?? [];

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field-input]").forEach((control) => {
    control.addEventListener("change", () => {
      const key = control.dataset.fieldInput;
      const field = fields.find((entry) => entry.key === key);
      if (!key || !field) {
        return;
      }

      const value = readEditedValue(control, field.dataType);
      if (value === effectiveValue(field)) {
        return;
      }

      const state = root.querySelector<HTMLElement>(`[data-field-state="${key}"]`);
      if (state) {
        state.textContent = "Saving…";
      }

      void sendJson("PATCH", fieldPath(documentId, key), { action: "edit", value }, documentResponseSchema).then(
        () => {
          field.reviewStatus = "edited";
          field.editedValue = value;
          if (state) {
            state.textContent = "Saved";
          }
        },
        (error: unknown) => {
          const message = messageFor(error);
          if (state) {
            state.textContent = message;
          } else {
            showError(root, message);
          }
        },
      );
    });
  });
}

function bindSourceToggles(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-source-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sourceToggle;
      const row = key ? root.querySelector<HTMLElement>(`[data-source-row="${key}"]`) : null;
      if (!row) {
        return;
      }

      row.hidden = !row.hidden;
      button.setAttribute("aria-expanded", String(!row.hidden));
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
        // Back to the queue the reviewer came from, not the engagement.
        window.history.pushState({}, "", "/documents");
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

    const detail = await getJson(
      `/api/documents/${encodeURIComponent(route.documentId)}`,
      documentDetailResponseSchema,
    );
    // The engagement is derived from the document, so its validations load second.
    const validations = await getJson(
      `/api/engagements/${encodeURIComponent(detail.document.engagementId)}/validations`,
      validationsResponseSchema,
    );

    return {
      engagementId: detail.document.engagementId,
      document: detail.document,
      documentType: detail.documentType ?? null,
      validations: validations.checks,
    };
  },
  render: renderReview,
  bind(root, data, repaint) {
    bindFieldInputs(root, data);
    bindSourceToggles(root);
    bindTrust(root, data, repaint);
    bindRerun(root, data, repaint);
    bindDefineDocumentType(root, data, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
