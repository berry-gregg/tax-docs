import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  portalStateSchema,
  portalWaiveResponseSchema,
  type PortalDocument,
  type PortalItem,
  type PortalState,
} from "../../../shared/schemas/api.ts";
import { taxDocumentSchema, type TaxDocument } from "../../../shared/schemas/document.ts";
import { ApiError, getJson, sendJson, uploadFile } from "../api.ts";
import { icons } from "../icons.ts";
import { escapeHtml } from "../render.ts";
import type { Route } from "../router.ts";
import type { PageModule } from "./registry.ts";

const portalUploadResponseSchema = z.object({
  document: taxDocumentSchema,
});

export type PortalData =
  | { kind: "invalid" }
  | { kind: "valid"; token: string; state: PortalState };

/**
 * View state that must survive the 2s poll repaint (main.ts swaps the whole `.workspace` node,
 * so DOM state dies with it). Render reads these; bind writes them.
 */
const openDocPanels = new Set<string>();
const openWaiveForms = new Set<string>();
const waiveDrafts = new Map<string, string>();

type PendingUpload = {
  id: string;
  filename: string;
  state: "uploading" | "processing" | "failed";
  /** Set on success so the row can be dropped once the poll returns the server's own copy. */
  documentId?: string;
  pipelineStatus?: TaxDocument["pipelineStatus"];
  error?: string;
};

let pendingUploads: PendingUpload[] = [];
let uploadSequence = 0;

/** Test seam: module view state would otherwise leak between test cases. */
export function resetPortalViewState(): void {
  openDocPanels.clear();
  openWaiveForms.clear();
  waiveDrafts.clear();
  pendingUploads = [];
  uploadSequence = 0;
}

function introLine(state: PortalState): string {
  return `${state.firmName} requested the following for ${state.clientName}'s ${state.taxYear} ${state.filingType} filing`;
}

/**
 * Client-facing pipeline vocabulary. Internal review states are the firm's work, not the
 * client's — a classified document reads as done, and every terminal failure reads as
 * needs attention without leaking why.
 */
const portalChipContent: Record<
  TaxDocument["pipelineStatus"],
  { label: string; tone: "processing" | "success" | "warning" }
> = {
  received: { label: "Received", tone: "processing" },
  "quality-review": { label: "Quality review", tone: "processing" },
  classifying: { label: "Classifying", tone: "processing" },
  extracting: { label: "Extracting", tone: "processing" },
  "needs-review": { label: "Done", tone: "success" },
  trusted: { label: "Done", tone: "success" },
  unclassified: { label: "Needs attention", tone: "warning" },
  rejected: { label: "Needs attention", tone: "warning" },
  failed: { label: "Needs attention", tone: "warning" },
};

function portalChip(status: TaxDocument["pipelineStatus"]): string {
  const { label, tone } = portalChipContent[status];
  return `<span class="chip chip-${tone}">${escapeHtml(label)}</span>`;
}

/** Honest, coarse messages for uploads that ended somewhere other than a checklist item. */
function unmatchedNote(status: TaxDocument["pipelineStatus"]): string | null {
  switch (status) {
    case "rejected":
      return "We couldn't accept this file — the firm will follow up";
    case "unclassified":
      return "We couldn't match this file to a requested document — the firm will take a look";
    case "failed":
      return "Processing failed for this file — please try uploading it again";
    default:
      return null;
  }
}

function portalFileHref(token: string, documentId: string): string {
  return `/api/portal/${encodeURIComponent(token)}/documents/${encodeURIComponent(documentId)}/file`;
}

function itemMark(item: PortalItem): string {
  if (item.status === "waived") {
    return `<span class="portal-mark portal-mark-waived" aria-hidden="true"></span>`;
  }
  if (item.status === "needs-attention" || item.portalStatus === "needs-attention") {
    return `<span class="portal-mark portal-mark-attention">${icons.warning}</span>`;
  }
  if (item.status === "received" || item.portalStatus === "received") {
    return `<span class="portal-mark portal-mark-received">${icons.check}</span>`;
  }
  return `<span class="portal-mark portal-mark-open" aria-hidden="true"></span>`;
}

function renderItemDocuments(item: PortalItem, token: string): string {
  if (item.documents.length === 0) {
    return "";
  }

  const rows = item.documents
    .map(
      (document) => `<li class="portal-doc">
        <span class="portal-doc-name" title="${escapeHtml(document.filename)}">${escapeHtml(document.filename)}</span>
        ${portalChip(document.pipelineStatus)}
        <a class="portal-doc-view" href="${portalFileHref(token, document.id)}" target="_blank" rel="noopener">View</a>
      </li>`,
    )
    .join("");
  const count = item.documents.length === 1 ? "1 file" : `${item.documents.length} files`;

  return `<details class="portal-item-docs" data-portal-docs="${escapeHtml(item.id)}"${openDocPanels.has(item.id) ? " open" : ""}>
    <summary class="portal-item-docs-summary">${escapeHtml(count)}</summary>
    <ul class="portal-doc-list">${rows}</ul>
  </details>`;
}

function renderWaiveControl(item: PortalItem): string {
  if (item.status !== "open") {
    return "";
  }

  const draft = waiveDrafts.get(item.id) ?? "";

  return `<div class="portal-waive">
    <button type="button" class="btn-ghost portal-waive-toggle" data-portal-waive="${escapeHtml(item.id)}">Not needed?</button>
    <form class="portal-waive-form" data-portal-waive-form="${escapeHtml(item.id)}"${openWaiveForms.has(item.id) ? "" : " hidden"}>
      <label class="form-field">
        <span class="form-label">Tell us why it isn't needed (optional)</span>
        <input type="text" maxlength="500" data-portal-waive-note value="${escapeHtml(draft)}" />
      </label>
      <div class="portal-waive-actions">
        <button type="submit" class="btn-secondary">Mark not needed</button>
        <button type="button" class="btn-ghost" data-portal-waive-cancel>Cancel</button>
      </div>
    </form>
  </div>`;
}

function renderChecklistItem(item: PortalItem, token: string): string {
  const waivedNote =
    item.status === "waived"
      ? `<p class="portal-waived-note muted">Not needed${item.waiveNote ? ` — ${escapeHtml(item.waiveNote)}` : ""}</p>`
      : "";

  return `<li class="portal-item" data-portal-item="${escapeHtml(item.id)}">
    ${itemMark(item)}
    <div class="portal-item-body">
      <p class="portal-item-title">${escapeHtml(item.title)}${item.required ? `<span class="portal-required">Required</span>` : ""}</p>
      <p class="portal-item-description muted">${escapeHtml(item.description)}</p>
      ${waivedNote}
      ${renderItemDocuments(item, token)}
      ${renderWaiveControl(item)}
    </div>
  </li>`;
}

function renderPendingRow(entry: PendingUpload): string {
  const name = `<span class="portal-doc-name" title="${escapeHtml(entry.filename)}">${escapeHtml(entry.filename)}</span>`;

  if (entry.state === "uploading") {
    return `<li class="portal-upload-row">${name}<span class="chip chip-processing">Uploading…</span></li>`;
  }
  if (entry.state === "failed") {
    return `<li class="portal-upload-row">
      ${name}
      <span class="chip chip-warning">Upload failed</span>
      <button type="button" class="btn-ghost portal-upload-dismiss" data-portal-dismiss="${escapeHtml(entry.id)}">Dismiss</button>
      <p class="portal-upload-note muted">${escapeHtml(entry.error ?? "Upload failed")}</p>
    </li>`;
  }
  return `<li class="portal-upload-row">${name}${portalChip(entry.pipelineStatus ?? "received")}</li>`;
}

function renderUnmatchedRow(document: PortalDocument): string {
  const note = unmatchedNote(document.pipelineStatus);

  return `<li class="portal-upload-row">
    <span class="portal-doc-name" title="${escapeHtml(document.filename)}">${escapeHtml(document.filename)}</span>
    ${portalChip(document.pipelineStatus)}
    ${note ? `<p class="portal-upload-note muted">${escapeHtml(note)}</p>` : ""}
  </li>`;
}

function renderUploadRows(state: PortalState): string {
  const rows = [
    ...pendingUploads.map(renderPendingRow),
    ...state.unmatched.map(renderUnmatchedRow),
  ];
  if (rows.length === 0) {
    return `<li class="portal-uploads-empty muted">Files you add appear here while they process</li>`;
  }
  return rows.join("");
}

/** Once the server reports an upload (matched or unmatched), its optimistic row is redundant. */
function prunePendingAgainst(state: PortalState): void {
  const known = new Set([
    ...state.unmatched.map((document) => document.id),
    ...state.items.flatMap((item) => item.documents.map((document) => document.id)),
  ]);
  pendingUploads = pendingUploads.filter(
    (entry) => !(entry.documentId !== undefined && known.has(entry.documentId)),
  );
}

function renderDropzone(): string {
  return `<div class="dropzone portal-dropzone" data-portal-dropzone tabindex="0" role="button" aria-label="Upload PDF documents">
    <span class="portal-dropzone-title">Drop PDFs here or click to browse</span>
    <span class="portal-dropzone-hint muted">Files are matched to the request list automatically</span>
    <input type="file" accept="application/pdf,.pdf" multiple hidden data-portal-file />
  </div>`;
}

function renderValidPortal(data: Extract<PortalData, { kind: "valid" }>): string {
  const { state, token } = data;
  prunePendingAgainst(state);

  return `<div class="portal-page">
    <header class="portal-header">
      <h1 class="portal-firm">${escapeHtml(state.firmName)}</h1>
      <p class="portal-intro">${escapeHtml(introLine(state))}</p>
    </header>
    <p class="load-error-message" data-portal-error hidden></p>
    <div class="portal-layout">
      <aside class="portal-checklist" aria-label="Requested documents">
        <h2 class="portal-section-title">Requested documents</h2>
        <ul class="portal-item-list">
          ${state.items.map((item) => renderChecklistItem(item, token)).join("")}
        </ul>
      </aside>
      <section class="portal-main">
        ${renderDropzone()}
        <section class="portal-uploads">
          <h2 class="portal-section-title">Recent uploads</h2>
          <ul class="portal-upload-list" data-portal-uploads aria-live="polite">${renderUploadRows(state)}</ul>
        </section>
      </section>
    </div>
  </div>`;
}

function renderInvalidPortal(): string {
  return `<div class="portal-page portal-invalid">
    <p class="portal-invalid-message">This link is no longer valid</p>
  </div>`;
}

export function renderPortal(data: PortalData): string {
  if (data.kind === "invalid") {
    return renderInvalidPortal();
  }

  return renderValidPortal(data);
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showPortalError(root: HTMLElement, message: string): void {
  const slot = root.querySelector<HTMLElement>("[data-portal-error]");
  if (!slot) {
    return;
  }

  slot.textContent = message;
  slot.hidden = false;
}

function bindUploads(root: HTMLElement, token: string, state: PortalState): void {
  const dropzone = root.querySelector<HTMLElement>("[data-portal-dropzone]");
  const input = dropzone?.querySelector<HTMLInputElement>("[data-portal-file]");
  const uploadsSlot = root.querySelector<HTMLElement>("[data-portal-uploads]");
  if (!dropzone || !input) {
    return;
  }

  const bindDismiss = () => {
    uploadsSlot?.querySelectorAll<HTMLElement>("[data-portal-dismiss]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-portal-dismiss");
        pendingUploads = pendingUploads.filter((entry) => entry.id !== id);
        refreshRows();
      });
    });
  };

  /** Patches the status list in place so drops feel instant; the poll repaint reconciles. */
  const refreshRows = () => {
    if (!uploadsSlot) {
      return;
    }
    uploadsSlot.innerHTML = renderUploadRows(state);
    bindDismiss();
  };

  const uploadAll = async (files: File[]) => {
    dropzone.setAttribute("aria-busy", "true");
    for (const file of files) {
      uploadSequence += 1;
      const entry: PendingUpload = {
        id: `pending-${uploadSequence}`,
        filename: file.name,
        state: "uploading",
      };
      pendingUploads.push(entry);
      refreshRows();
      try {
        const { document } = await uploadFile(
          `/api/portal/${encodeURIComponent(token)}/upload`,
          file,
          {},
          portalUploadResponseSchema,
        );
        entry.state = "processing";
        entry.documentId = document.id;
        entry.pipelineStatus = document.pipelineStatus;
      } catch (error) {
        entry.state = "failed";
        entry.error = messageFor(error);
      }
      refreshRows();
    }
    dropzone.removeAttribute("aria-busy");
  };

  const onFiles = (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    if (list.length > 0) {
      void uploadAll(list);
    }
  };

  dropzone.addEventListener("click", () => {
    input.click();
  });

  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  input.addEventListener("change", () => {
    onFiles(input.files);
    input.value = "";
  });

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-dragover");
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    onFiles(event.dataTransfer?.files);
  });

  bindDismiss();
}

function bindDocPanels(root: HTMLElement): void {
  root.querySelectorAll<HTMLDetailsElement>("[data-portal-docs]").forEach((details) => {
    const itemId = details.getAttribute("data-portal-docs");
    if (!itemId) {
      return;
    }

    details.addEventListener("toggle", () => {
      if (details.open) {
        openDocPanels.add(itemId);
      } else {
        openDocPanels.delete(itemId);
      }
    });
  });
}

function bindWaiveControls(root: HTMLElement, token: string): void {
  root.querySelectorAll<HTMLElement>("[data-portal-waive]").forEach((toggle) => {
    const itemId = toggle.getAttribute("data-portal-waive");
    if (!itemId) {
      return;
    }

    const form = root.querySelector<HTMLFormElement>(`[data-portal-waive-form="${itemId}"]`);
    if (!form) {
      return;
    }
    const note = form.querySelector<HTMLInputElement>("[data-portal-waive-note]");
    const cancel = form.querySelector<HTMLElement>("[data-portal-waive-cancel]");

    const close = () => {
      openWaiveForms.delete(itemId);
      waiveDrafts.delete(itemId);
      form.hidden = true;
    };

    toggle.addEventListener("click", () => {
      openWaiveForms.add(itemId);
      form.hidden = false;
      note?.focus();
    });

    cancel?.addEventListener("click", close);

    note?.addEventListener("input", () => {
      waiveDrafts.set(itemId, note.value);
    });

    note?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = note?.value.trim() ?? "";
      void sendJson(
        "POST",
        `/api/portal/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}/waive`,
        value.length > 0 ? { note: value } : {},
        portalWaiveResponseSchema,
      )
        .then(() => {
          close();
        })
        .catch((error: unknown) => {
          showPortalError(root, messageFor(error));
        });
    });
  });
}

export const portalPage: PageModule<PortalData> = {
  async load(route: Route) {
    if (route.page !== "portal") {
      throw new Error("portal page loaded for wrong route");
    }

    try {
      const state = await getJson(
        `/api/portal/${encodeURIComponent(route.token)}`,
        portalStateSchema,
      );
      return { kind: "valid", token: route.token, state };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        return { kind: "invalid" };
      }
      throw error;
    }
  },
  render: renderPortal,
  bind(root, data) {
    if (data.kind !== "valid") {
      return;
    }

    bindUploads(root, data.token, data.state);
    bindDocPanels(root);
    bindWaiveControls(root, data.token);
  },
  pollMs: POLL_INTERVAL_MS,
};
