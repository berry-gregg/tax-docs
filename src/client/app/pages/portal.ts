import { z } from "zod";
import { POLL_INTERVAL_MS } from "../../../shared/constants.ts";
import { portalStateSchema, type PortalState } from "../../../shared/schemas/api.ts";
import { taxDocumentSchema } from "../../../shared/schemas/document.ts";
import { ApiError, getJson, uploadFile } from "../api.ts";
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

function introLine(state: PortalState): string {
  return `${state.firmName} requested the following for ${state.clientName}'s ${state.taxYear} ${state.filingType} filing`;
}

function renderDropzone(token: string, requestItemId?: string): string {
  const itemAttr =
    requestItemId === undefined
      ? 'data-portal-dropzone="general"'
      : `data-portal-dropzone data-request-item-id="${escapeHtml(requestItemId)}"`;

  return `<div class="dropzone" ${itemAttr} data-portal-token="${escapeHtml(token)}" tabindex="0" role="button">
    <span>Drop a PDF here or click to browse</span>
    <input type="file" accept="application/pdf,.pdf" hidden data-portal-file />
  </div>`;
}

function renderItemStatus(item: PortalState["items"][number], token: string): string {
  switch (item.portalStatus) {
    case "waiting":
      return renderDropzone(token, item.id);
    case "processing":
      return `<div class="portal-status portal-status-processing">
        <span class="portal-spinner" aria-hidden="true"></span>
        <span>Processing…</span>
      </div>`;
    case "received":
      return `<div class="portal-status portal-status-received">
        ${icons.check}
        <span>Received</span>
      </div>`;
    case "needs-attention":
      return `<div class="portal-status portal-status-attention">
        ${icons.warning}
        <span>Needs attention — we'll follow up shortly</span>
      </div>`;
  }
}

function renderPortalCard(item: PortalState["items"][number], token: string): string {
  return `<article class="portal-card">
    <h2 class="portal-card-title">${escapeHtml(item.title)}</h2>
    <p class="portal-card-description muted">${escapeHtml(item.description)}</p>
    ${renderItemStatus(item, token)}
  </article>`;
}

function renderValidPortal(data: Extract<PortalData, { kind: "valid" }>): string {
  const { state, token } = data;

  return `<div class="portal-page">
    <header class="portal-header">
      <h1 class="portal-firm">${escapeHtml(state.firmName)}</h1>
      <p class="portal-intro">${escapeHtml(introLine(state))}</p>
    </header>
    <p class="load-error-message" data-portal-error hidden></p>
    <div class="portal-checklist">
      ${state.items.map((item) => renderPortalCard(item, token)).join("")}
    </div>
    <section class="portal-general">
      <h2 class="portal-general-title">Something else to send?</h2>
      ${renderDropzone(token)}
    </section>
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

function bindDropzone(
  dropzone: HTMLElement,
  token: string,
  requestItemId: string | undefined,
  repaint: () => void,
  root: HTMLElement,
): void {
  const input = dropzone.querySelector<HTMLInputElement>("[data-portal-file]");
  if (!input) {
    return;
  }

  const uploadPath = `/api/portal/${encodeURIComponent(token)}/upload`;
  const extra: Record<string, string> = requestItemId ? { requestItemId } : {};

  const startUpload = (file: File) => {
    dropzone.setAttribute("aria-busy", "true");
    void uploadFile(uploadPath, file, extra, portalUploadResponseSchema)
      .then(() => repaint())
      .catch((error: unknown) => {
        showPortalError(root, messageFor(error));
      })
      .finally(() => {
        dropzone.removeAttribute("aria-busy");
        input.value = "";
      });
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
    const file = input.files?.[0];
    if (file) {
      startUpload(file);
    }
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
    const file = event.dataTransfer?.files[0];
    if (file) {
      startUpload(file);
    }
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

    root.querySelectorAll<HTMLElement>("[data-portal-dropzone]").forEach((dropzone) => {
      const token = dropzone.getAttribute("data-portal-token") ?? data.token;
      const requestItemId = dropzone.getAttribute("data-request-item-id") ?? undefined;
      bindDropzone(dropzone, token, requestItemId, repaint, root);
    });
  },
  pollMs: POLL_INTERVAL_MS,
};
