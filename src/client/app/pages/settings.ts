import { z } from "zod";
import { FIRM_NAME } from "../../../shared/constants.ts";
import {
  documentTypeSchema,
  type CreateDocumentTypeInput,
  type DocumentType,
  type UpdateDocumentTypeInput,
} from "../../../shared/schemas/document-type.ts";
import { documentTypesResponseSchema } from "../../../shared/schemas/api.ts";
import { getJson, sendJson } from "../api.ts";
import { bindSchemaBuilder, renderSchemaBuilder } from "../components/schema-builder.ts";
import {
  dataTable,
  emptyState,
  escapeHtml,
  pageHeader,
  tabs,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

export type SettingsData = {
  documentTypes: DocumentType[];
  tab?: SettingsTab;
};

type SettingsTab = "company" | "document-types";

const documentTypeResponseSchema = z.object({
  documentType: documentTypeSchema,
});

export function renderSettings(data: SettingsData): string {
  const current = data.tab ?? "document-types";
  const companyCurrent = current === "company";
  const documentTypesCurrent = current === "document-types";

  return `${pageHeader("Settings")}
    ${tabs([
      { label: "Company profile", current: companyCurrent, href: "/settings?tab=company" },
      {
        label: "Document types",
        count: data.documentTypes.length,
        current: documentTypesCurrent,
        href: "/settings?tab=document-types",
      },
    ])}
    <section class="settings-block" data-settings-panel="company" ${companyCurrent ? "" : "hidden"}>
      <dl class="definition-grid">
        <div>
          <dt>Firm</dt>
          <dd>${escapeHtml(FIRM_NAME)}</dd>
        </div>
        <div>
          <dt>API status</dt>
          <dd><span data-api-status data-state="idle">Not checked</span></dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd><span data-db-status>Not checked</span></dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>Document collection and review</dd>
        </div>
      </dl>
    </section>
    <section class="settings-block" data-settings-panel="document-types" ${documentTypesCurrent ? "" : "hidden"}>
      <div class="settings-section-head">
        <div>
          <h2 class="section-title">Document types</h2>
          <p class="muted">Definitions the classifier and extractor use to understand client uploads.</p>
        </div>
        <button class="btn-primary" type="button" data-new-document-type>New document type</button>
      </div>
      <p class="modal-error" data-settings-error hidden></p>
      ${
        data.documentTypes.length === 0
          ? emptyState("No document types yet. Create one before classifying custom client uploads.")
          : dataTable(
              ["Name", "Description", "Fields", "Created by", "Status"],
              data.documentTypes.map(renderDocumentTypeRow),
              `1-${data.documentTypes.length} of ${data.documentTypes.length}`,
            )
      }
      <div data-schema-panel-slot></div>
    </section>`;
}

export const settingsPage: PageModule<SettingsData> = {
  async load() {
    const payload = await getJson("/api/document-types", documentTypesResponseSchema);
    return { ...payload, tab: currentSettingsTab() };
  },
  render: renderSettings,
  bind(root, data, repaint) {
    bindSettings(root, data, repaint);
  },
};

function currentSettingsTab(): SettingsTab {
  if (typeof window === "undefined") {
    return "document-types";
  }

  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "company" ? "company" : "document-types";
}

function renderDocumentTypeRow(documentType: DocumentType): string {
  const status = documentType.active ? "Active" : "Inactive";
  return `<tr data-document-type-row="${escapeHtml(documentType.id)}" tabindex="0">
    <td>${escapeHtml(documentType.name)}</td>
    <td>${escapeHtml(documentType.description)}</td>
    <td>${documentType.fields.length} ${documentType.fields.length === 1 ? "field" : "fields"}</td>
    <td>${createdByChip(documentType.createdBy)}</td>
    <td>
      <label class="checkbox toggle-field">
        <input class="visually-hidden-input" type="checkbox" data-document-type-active="${escapeHtml(documentType.id)}" ${documentType.active ? "checked" : ""} />
        <span class="checkbox-box" aria-hidden="true"></span>
        <span>${status}</span>
      </label>
    </td>
  </tr>`;
}

const createdByLabels: Record<DocumentType["createdBy"], string> = {
  cpa: "CPA",
  seed: "Seed",
};

/** Provenance is not a success state — both origins stay in the neutral ash tone. */
function createdByChip(createdBy: DocumentType["createdBy"]): string {
  return `<span class="chip chip-processing">${escapeHtml(createdByLabels[createdBy])}</span>`;
}

function bindSettings(root: HTMLElement, data: SettingsData, repaint: () => void): void {
  root.querySelector("[data-new-document-type]")?.addEventListener("click", () => {
    openBuilder(root, null, async (input) => {
      await sendJson("POST", "/api/document-types", input, documentTypeResponseSchema);
      repaint();
    });
  });

  root.querySelectorAll<HTMLInputElement>("[data-document-type-active]").forEach((toggle) => {
    toggle.addEventListener("change", async () => {
      const id = toggle.dataset.documentTypeActive;
      if (!id) {
        return;
      }
      const body: UpdateDocumentTypeInput = { active: toggle.checked };
      try {
        await sendJson("PATCH", `/api/document-types/${encodeURIComponent(id)}`, body, documentTypeResponseSchema);
        clearSettingsError(root);
        repaint();
      } catch (error) {
        toggle.checked = !toggle.checked;
        showSettingsError(root, error);
      }
    });
  });

  root.querySelectorAll<HTMLElement>("[data-document-type-row]").forEach((row) => {
    row.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (target?.closest(".toggle-field")) {
        return;
      }

      const documentType = data.documentTypes.find((entry) => entry.id === row.dataset.documentTypeRow);
      if (documentType) {
        openBuilder(root, documentType, async (input) => {
          await sendJson(
            "PATCH",
            `/api/document-types/${encodeURIComponent(documentType.id)}`,
            input,
            documentTypeResponseSchema,
          );
          repaint();
        });
      }
    });

    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      const documentType = data.documentTypes.find((entry) => entry.id === row.dataset.documentTypeRow);
      if (documentType) {
        openBuilder(root, documentType, async (input) => {
          await sendJson(
            "PATCH",
            `/api/document-types/${encodeURIComponent(documentType.id)}`,
            input,
            documentTypeResponseSchema,
          );
          repaint();
        });
      }
    });
  });
}

function openBuilder(
  root: HTMLElement,
  draft: DocumentType | null,
  onSave: (input: CreateDocumentTypeInput) => Promise<void>,
): void {
  const slot = root.querySelector<HTMLElement>("[data-schema-panel-slot]");
  if (!slot || slot.querySelector(".side-panel")) {
    return;
  }

  const input = draft ? toBuilderInput(draft) : null;
  slot.innerHTML = `<div class="modal" data-schema-scrim aria-hidden="true"></div>${renderSchemaBuilder(input)}`;
  const panel = slot.querySelector<HTMLElement>(".side-panel");
  if (!panel) {
    return;
  }

  bindSchemaBuilder(panel, {
    onClose() {
      slot.innerHTML = "";
    },
    onSave(input) {
      void onSave(input)
        .then(() => {
          slot.innerHTML = "";
        })
        .catch((error: unknown) => {
          const formError = panel.querySelector<HTMLElement>("[data-schema-form-error]");
          if (formError) {
            formError.hidden = false;
            formError.textContent = settingsErrorMessage(error);
          }
        });
    },
  });
}

function settingsErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showSettingsError(root: ParentNode, error: unknown): void {
  const slot = root.querySelector<HTMLElement>("[data-settings-error]");
  if (!slot) {
    return;
  }

  slot.hidden = false;
  slot.textContent = settingsErrorMessage(error);
}

function clearSettingsError(root: ParentNode): void {
  const slot = root.querySelector<HTMLElement>("[data-settings-error]");
  if (!slot) {
    return;
  }

  slot.hidden = true;
  slot.textContent = "";
}

function toBuilderInput(documentType: DocumentType): CreateDocumentTypeInput {
  return {
    name: documentType.name,
    description: documentType.description,
    active: documentType.active,
    fields: documentType.fields,
  };
}
