import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import {
  portalMessageResponseSchema,
  portalStateSchema,
  portalWaiveResponseSchema,
  type PortalDocument,
  type PortalItem,
  type PortalState,
} from "../../../shared/schemas/api.ts";
import type { Message } from "../../../shared/schemas/message.ts";
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
const openItemPanels = new Set<string>();
const openWaiveForms = new Set<string>();
const waiveDrafts = new Map<string, string>();
let messageDraft = "";

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
  openItemPanels.clear();
  openWaiveForms.clear();
  waiveDrafts.clear();
  messageDraft = "";
  pendingUploads = [];
  uploadSequence = 0;
}

function introLine(state: PortalState): string {
  return `${state.firmName} requested the following for ${state.clientName}'s ${state.taxYear} ${state.filingType} filing`;
}

/** Letterhead monogram — the first letter of the firm's first two words. */
function firmInitials(firmName: string): string {
  return firmName
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => (word[0] ?? "").toUpperCase())
    .join("");
}

/**
 * "N of M received" over the non-waived checklist — the one number a client actually wants.
 * Hidden when nothing is tracked so an empty request never shows "0 of 0".
 */
function renderProgress(state: PortalState): string {
  const tracked = state.items.filter((item) => item.status !== "waived");
  if (tracked.length === 0) {
    return "";
  }

  const received = tracked.filter((item) => item.status === "received").length;
  const percent = Math.round((received / tracked.length) * 100);

  return `<div class="portal-progress" data-portal-progress>
    <span class="portal-progress-label">${received} of ${tracked.length} received</span>
    <span class="portal-progress-track" aria-hidden="true"><span class="portal-progress-fill" style="width: ${percent}%"></span></span>
  </div>`;
}

/** Card head row — title left, quiet meta right, hairline underneath. */
function panelHead(title: string, meta?: string): string {
  return `<header class="portal-panel-head">
    <h2 class="portal-section-title">${escapeHtml(title)}</h2>
    ${meta ? `<span class="portal-panel-meta">${escapeHtml(meta)}</span>` : ""}
  </header>`;
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

  return `<ul class="portal-doc-list">${rows}</ul>`;
}

function fileCount(item: PortalItem): string {
  if (item.documents.length === 0) {
    return "";
  }
  const count = item.documents.length === 1 ? "1 file" : `${item.documents.length} files`;
  return `<span class="portal-item-count">${escapeHtml(count)}</span>`;
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

/**
 * One compact summary line per item — mark, title, Required badge, file count. Description,
 * nested files, the waived note, and the waive control live behind the disclosure. An open
 * waive form pins its panel open so a repaint cannot fold the form away mid-note.
 */
function renderChecklistItem(item: PortalItem, token: string): string {
  const waivedNote =
    item.status === "waived"
      ? `<p class="portal-waived-note muted">Not needed${item.waiveNote ? ` — ${escapeHtml(item.waiveNote)}` : ""}</p>`
      : "";
  const expanded = openItemPanels.has(item.id) || openWaiveForms.has(item.id);

  return `<li class="portal-item" data-portal-item="${escapeHtml(item.id)}">
    <details class="portal-item-panel" data-portal-panel="${escapeHtml(item.id)}"${expanded ? " open" : ""}>
      <summary class="portal-item-summary">${itemMark(item)}<span class="portal-item-title">${escapeHtml(item.title)}</span>${item.required ? `<span class="portal-required">Required</span>` : ""}${fileCount(item)}<span class="portal-item-chevron" aria-hidden="true">${icons.chevron}</span></summary>
      <div class="portal-item-body">
        <p class="portal-item-description muted">${escapeHtml(item.description)}</p>
        ${waivedNote}
        ${renderItemDocuments(item, token)}
        ${renderWaiveControl(item)}
      </div>
    </details>
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
    <span class="portal-dropzone-icon" aria-hidden="true">${icons.upload}</span>
    <span class="portal-dropzone-title">Drop PDFs here or click to browse</span>
    <span class="portal-dropzone-hint muted">Files are matched to the request list automatically</span>
    <input type="file" accept="application/pdf,.pdf" multiple hidden data-portal-file />
  </div>`;
}

function renderMessageRow(message: Message, firmName: string): string {
  const sender = message.sender === "cpa" ? firmName : "You";
  return `<li class="portal-message portal-message-${message.sender}">
    <span class="portal-message-sender">${escapeHtml(sender)}</span>
    <p class="portal-message-body">${escapeHtml(message.body)}</p>
  </li>`;
}

function renderMessagesPanel(state: PortalState): string {
  const rows =
    state.messages.length > 0
      ? state.messages.map((message) => renderMessageRow(message, state.firmName)).join("")
      : `<li class="portal-messages-empty muted">No messages yet — questions about this request start here</li>`;

  const count = state.messages.length;
  const meta = count > 0 ? (count === 1 ? "1 message" : `${count} messages`) : undefined;

  return `<aside class="portal-messages portal-card" aria-label="Messages">
    ${panelHead("Messages", meta)}
    <p class="portal-messages-hint muted">Questions for ${escapeHtml(state.firmName)} about this request</p>
    <ul class="portal-message-list" data-portal-messages aria-live="polite">${rows}</ul>
    <form class="portal-compose" data-portal-compose data-preserve-focus>
      <textarea class="portal-compose-input" data-portal-compose-body maxlength="2000" rows="3" placeholder="Write a message" aria-label="Write a message">${escapeHtml(messageDraft)}</textarea>
      <div class="portal-compose-actions">
        <button type="submit" class="btn-secondary">Send</button>
      </div>
    </form>
  </aside>`;
}

function renderValidPortal(data: Extract<PortalData, { kind: "valid" }>): string {
  const { state, token } = data;
  prunePendingAgainst(state);

  const itemCount = state.items.length === 1 ? "1 item" : `${state.items.length} items`;

  return `<div class="portal-page">
    <header class="portal-header">
      <div class="portal-identity">
        <span class="portal-monogram" aria-hidden="true">${escapeHtml(firmInitials(state.firmName))}</span>
        <h1 class="portal-firm">${escapeHtml(state.firmName)}</h1>
      </div>
      <div class="portal-heading">
        <p class="portal-title">Document request</p>
        <p class="portal-intro">${escapeHtml(introLine(state))}</p>
      </div>
      ${renderProgress(state)}
    </header>
    <p class="load-error-message" data-portal-error hidden></p>
    <div class="portal-layout">
      <aside class="portal-checklist portal-card" aria-label="Requested documents">
        ${panelHead("Requested documents", itemCount)}
        <ul class="portal-item-list">
          ${state.items.map((item) => renderChecklistItem(item, token)).join("")}
        </ul>
      </aside>
      <section class="portal-main portal-card">
        ${panelHead("Upload files")}
        ${renderDropzone()}
        <section class="portal-uploads">
          <h3 class="portal-section-title portal-subsection-title">Recent uploads</h3>
          <ul class="portal-upload-list" data-portal-uploads aria-live="polite">${renderUploadRows(state)}</ul>
        </section>
      </section>
      ${renderMessagesPanel(state)}
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

function bindItemPanels(root: HTMLElement): void {
  root.querySelectorAll<HTMLDetailsElement>("[data-portal-panel]").forEach((details) => {
    const itemId = details.getAttribute("data-portal-panel");
    if (!itemId) {
      return;
    }

    details.addEventListener("toggle", () => {
      if (details.open) {
        openItemPanels.add(itemId);
      } else {
        openItemPanels.delete(itemId);
      }
    });
  });
}

function bindMessages(root: HTMLElement, token: string, repaint: () => void): void {
  const form = root.querySelector<HTMLFormElement>("[data-portal-compose]");
  const input = form?.querySelector<HTMLTextAreaElement>("[data-portal-compose-body]");
  if (!form || !input) {
    return;
  }

  input.addEventListener("input", () => {
    messageDraft = input.value;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (body.length === 0) {
      return;
    }

    // Optimistic clear; the repaint pulls the fresh thread. A failure restores the draft.
    messageDraft = "";
    input.value = "";
    void sendJson(
      "POST",
      `/api/portal/${encodeURIComponent(token)}/messages`,
      { body },
      portalMessageResponseSchema,
    )
      .then(() => {
        repaint();
      })
      .catch((error: unknown) => {
        messageDraft = body;
        input.value = body;
        showPortalError(root, messageFor(error));
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
  bind(root, data, repaint) {
    if (data.kind !== "valid") {
      return;
    }

    bindUploads(root, data.token, data.state);
    bindItemPanels(root);
    bindWaiveControls(root, data.token);
    bindMessages(root, data.token, repaint);
  },
  pollMs: POLL_INTERVAL_MS,
};
