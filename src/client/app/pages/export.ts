import { z } from "zod";
import { engagementDetailSchema } from "../../../shared/schemas/api.ts";
import { exportSchema, type EngineExport, type ExportLine } from "../../../shared/schemas/export.ts";
import type { FilingType } from "../../../shared/schemas/engagement.ts";
import { ApiError, getJson, sendJson } from "../api.ts";
import { formatMoney } from "../format.ts";
import { dataTable, escapeHtml, pageHeader } from "../render.ts";
import type { Route } from "../router.ts";
import type { PageModule } from "./registry.ts";

const exportResponseSchema = z.object({ export: exportSchema });

export type ExportData = {
  engagementId: string;
  clientName: string;
  taxYear: number;
  filingType: FilingType;
  export: EngineExport | null;
  blocked: string | null;
};

function assertExportRoute(route: Route): asserts route is Extract<Route, { page: "export" }> {
  if (route.page !== "export") {
    throw new Error("Export page loaded for a non-export route");
  }
}

export function formatLineValue(value: ExportLine["value"]): string {
  if (value === null) {
    return `<span class="muted">Missing — no trusted source</span>`;
  }

  if (typeof value === "number") {
    return escapeHtml(formatMoney(value));
  }

  return escapeHtml(String(value));
}

function renderSourceRefs(engagementId: string, refs: ExportLine["sourceRefs"]): string {
  if (refs.length === 0) {
    return `<span class="muted">—</span>`;
  }

  return refs
    .map(
      (ref) =>
        `<a class="text-link" href="/engagements/${escapeHtml(engagementId)}/review/${escapeHtml(ref.documentId)}" data-nav-link>${escapeHtml(ref.fieldKey)}</a>`,
    )
    .join(", ");
}

function renderLineRows(data: ExportData): string[] {
  const lines = data.export?.lines ?? [];

  return lines.map(
    (line) => `<tr>
      <td>${escapeHtml(line.engineForm)}</td>
      <td>${escapeHtml(line.lineId)}</td>
      <td>${escapeHtml(line.lineLabel)}</td>
      <td>${formatLineValue(line.value)}</td>
      <td>${renderSourceRefs(data.engagementId, line.sourceRefs)}</td>
    </tr>`,
  );
}

function confirmModalCopy(data: ExportData): string {
  const lineCount = data.export?.lines.length ?? 0;

  return `This sends ${lineCount} line items for ${data.clientName} ${data.taxYear} ${data.filingType} to the tax engine. This is the human confirmation step — nothing has been sent yet.`;
}

function renderConfirmModal(data: ExportData): string {
  if (!data.export || data.export.status !== "draft") {
    return "";
  }

  return `<div class="modal" hidden data-export-confirm-modal>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="export-confirm-title">
      <h2 class="modal-title" id="export-confirm-title">Confirm export</h2>
      <p>${escapeHtml(confirmModalCopy(data))}</p>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-export-cancel>Cancel</button>
        <button class="btn-primary" type="button" data-export-confirm>Confirm &amp; send to tax engine</button>
      </div>
    </div>
  </div>`;
}

function renderSentBanner(exportRecord: EngineExport): string {
  const confirmedAt = exportRecord.confirmedAt ?? "";

  return `<div class="wash-card" data-export-sent>
    <p class="wash-title">Export sent to tax engine</p>
    <p class="muted">Confirmed ${escapeHtml(confirmedAt)}</p>
  </div>`;
}

function renderBlocked(data: ExportData): string {
  return `<div class="page-export">
    ${pageHeader("Export")}
    <div class="wash-card">
      <p>${escapeHtml(data.blocked ?? "")}</p>
      <a class="text-link" href="/engagements/${escapeHtml(data.engagementId)}" data-nav-link>Back to engagement workspace</a>
    </div>
  </div>`;
}

export function renderExport(data: ExportData): string {
  if (data.blocked) {
    return renderBlocked(data);
  }

  const exportRecord = data.export;
  if (!exportRecord) {
    return renderBlocked({ ...data, blocked: "Export could not be loaded" });
  }

  const lineCount = exportRecord.lines.length;
  const footer = `1–${lineCount} of ${lineCount}`;
  const headerActions =
    exportRecord.status === "sent"
      ? [{ href: `/api/exports/${exportRecord.id}/payload`, label: "Download payload", kind: "secondary" as const }]
      : [];

  return `<div class="page-export" data-export-id="${escapeHtml(exportRecord.id)}">
    ${pageHeader("Export", String(lineCount), headerActions)}
    ${exportRecord.status === "sent" ? renderSentBanner(exportRecord) : ""}
    ${dataTable(
      ["Engine form", "Line", "Label", "Value", "Sources"],
      renderLineRows(data),
      footer,
    )}
    ${
      exportRecord.status === "draft"
        ? `<footer class="page-header">
            <div></div>
            <div class="page-actions">
              <button class="btn-primary" type="button" data-export-open>Confirm &amp; send to tax engine</button>
            </div>
          </footer>`
        : ""
    }
    ${renderConfirmModal(data)}
  </div>`;
}

function bindExportModal(root: HTMLElement, data: ExportData, repaint: () => void): void {
  const exportRecord = data.export;
  if (!exportRecord || exportRecord.status !== "draft") {
    return;
  }

  const modal = root.querySelector<HTMLElement>("[data-export-confirm-modal]");
  const openButton = root.querySelector<HTMLButtonElement>("[data-export-open]");
  const cancelButton = root.querySelector<HTMLButtonElement>("[data-export-cancel]");
  const confirmButton = root.querySelector<HTMLButtonElement>("[data-export-confirm]");

  openButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if (modal) {
      modal.hidden = false;
    }
  });

  cancelButton?.addEventListener("click", () => {
    if (modal) {
      modal.hidden = true;
    }
  });

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.hidden = true;
    }
  });

  confirmButton?.addEventListener("click", () => {
    void (async () => {
      try {
        const confirmed = await sendJson(
          "POST",
          `/api/exports/${exportRecord.id}/confirm`,
          {},
          exportResponseSchema,
        );
        root.innerHTML = renderExport({ ...data, export: confirmed.export });
        bindExport(root, { ...data, export: confirmed.export }, repaint);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        window.alert(message);
      }
    })();
  });
}

function bindExport(root: HTMLElement, data: ExportData, repaint: () => void): void {
  bindExportModal(root, data, repaint);
}

export const exportPage: PageModule<ExportData> = {
  async load(route) {
    assertExportRoute(route);

    const detail = await getJson(`/api/engagements/${route.engagementId}`, engagementDetailSchema);

    try {
      const built = await sendJson(
        "POST",
        `/api/engagements/${route.engagementId}/export`,
        {},
        exportResponseSchema,
      );

      return {
        engagementId: route.engagementId,
        clientName: detail.client.legalName,
        taxYear: detail.engagement.taxYear,
        filingType: detail.engagement.filingType,
        export: built.export,
        blocked: null,
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        return {
          engagementId: route.engagementId,
          clientName: detail.client.legalName,
          taxYear: detail.engagement.taxYear,
          filingType: detail.engagement.filingType,
          export: null,
          blocked: error.message,
        };
      }

      throw error;
    }
  },
  render: renderExport,
  bind: bindExport,
};
