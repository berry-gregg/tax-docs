import { z } from "zod";
import {
  clientListResponseSchema,
} from "../../../shared/schemas/api.ts";
import {
  clientSchema,
  createClientInputSchema,
  entityTypeSchema,
  type Client,
} from "../../../shared/schemas/client.ts";
import { ApiError, getJson, sendJson } from "../api.ts";
import {
  dataTable,
  entityCell,
  escapeHtml,
  initialsFor,
  pageHeader,
  toolbar,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

const createClientResponseSchema = z.object({ client: clientSchema });

const entityTypeLabels: Record<z.infer<typeof entityTypeSchema>, string> = {
  "s-corp": "S corporation",
  partnership: "Partnership",
  "c-corp": "C corporation",
  llc: "LLC",
};

export type ClientsData = {
  clients: Client[];
  modalOpen: boolean;
  modalError: string | null;
};

function shouldOpenNewClientModal(search: string): boolean {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("new") === "1";
}

function renderNewClientModal(open: boolean, error: string | null): string {
  return `<div class="modal" data-new-client-modal ${open ? "" : "hidden"}>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-client-title">
      <h2 class="modal-title" id="new-client-title">New client</h2>
      <form class="form-grid" data-new-client-form>
        ${error ? `<p class="modal-error" data-new-client-error>${escapeHtml(error)}</p>` : `<p class="modal-error" data-new-client-error hidden></p>`}
        <label class="form-field">
          <span class="form-label">Legal name</span>
          <input type="text" name="legalName" required autocomplete="organization" />
        </label>
        <label class="form-field">
          <span class="form-label">Entity type</span>
          <select name="entityType" required>
            ${entityTypeSchema.options
              .map(
                (value) =>
                  `<option value="${value}">${escapeHtml(entityTypeLabels[value])}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">EIN</span>
          <input type="text" name="ein" required placeholder="XX-XXXXXXX" autocomplete="off" />
          <span class="form-hint">Format: XX-XXXXXXX</span>
        </label>
        <label class="form-field">
          <span class="form-label">Contact name</span>
          <input type="text" name="contactName" required autocomplete="name" />
        </label>
        <label class="form-field">
          <span class="form-label">Contact email</span>
          <input type="email" name="contactEmail" required autocomplete="email" />
        </label>
        <label class="form-field">
          <span class="form-label">City</span>
          <input type="text" name="city" required autocomplete="address-level2" />
        </label>
        <label class="form-field">
          <span class="form-label">State</span>
          <input type="text" name="state" required autocomplete="address-level1" />
        </label>
        <div class="modal-actions">
          <button class="btn-secondary" type="button" data-close-new-client>Cancel</button>
          <button class="btn-primary" type="submit" data-submit-new-client>Create client</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderClientRow(client: Client): string {
  return `<tr data-href="/clients/${escapeHtml(client.id)}" tabindex="0">
    <td>${entityCell(initialsFor(client.legalName), client.legalName, client.contactEmail)}</td>
    <td>${escapeHtml(entityTypeLabels[client.entityType])}</td>
    <td>${escapeHtml(client.contactName)}<div class="muted">${escapeHtml(client.contactEmail)}</div></td>
    <td>${escapeHtml(`${client.city}, ${client.state}`)}</td>
  </tr>`;
}

function tableFooter(count: number): string {
  if (count === 0) {
    return "0 clients";
  }

  return `1–${count} of ${count} clients`;
}

export function renderClients(data: ClientsData): string {
  return `${pageHeader("Clients", String(data.clients.length), [
    { href: "/clients?new=1", label: "New client", kind: "primary" },
  ])}
    ${toolbar("Filter clients…")}
    ${dataTable(
      ["Name", "Entity", "Contact", "Location"],
      data.clients.map(renderClientRow),
      tableFooter(data.clients.length),
    )}
    ${renderNewClientModal(data.modalOpen, data.modalError)}`;
}

function readClientForm(form: HTMLFormElement) {
  const data = new FormData(form);

  return createClientInputSchema.parse({
    legalName: String(data.get("legalName") ?? ""),
    entityType: data.get("entityType"),
    ein: String(data.get("ein") ?? ""),
    contactName: String(data.get("contactName") ?? ""),
    contactEmail: String(data.get("contactEmail") ?? ""),
    city: String(data.get("city") ?? ""),
    state: String(data.get("state") ?? ""),
  });
}

function bindTableRows(root: HTMLElement, repaint: () => void): void {
  root.querySelectorAll<HTMLElement>("[data-href]").forEach((row) => {
    row.addEventListener("click", () => {
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

function bindNewClientModal(root: HTMLElement, repaint: () => void): void {
  const modal = root.querySelector<HTMLElement>("[data-new-client-modal]");
  const form = root.querySelector<HTMLFormElement>("[data-new-client-form]");
  const errorEl = root.querySelector<HTMLElement>("[data-new-client-error]");

  const closeModal = () => {
    modal?.setAttribute("hidden", "");
    if (shouldOpenNewClientModal(window.location.search)) {
      window.history.replaceState({}, "", "/clients");
    }
  };

  root.querySelector("[data-close-new-client]")?.addEventListener("click", closeModal);

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();

    void (async () => {
      try {
        const body = readClientForm(form);
        await sendJson("POST", "/api/clients", body, createClientResponseSchema);
        window.history.replaceState({}, "", "/clients");
        closeModal();
        repaint();
      } catch (error) {
        if (!(error instanceof ApiError) || !errorEl) {
          return;
        }

        errorEl.hidden = false;
        errorEl.textContent = error.message;
      }
    })();
  });
}

export const clientsPage: PageModule<ClientsData> = {
  async load() {
    const payload = await getJson("/api/clients", clientListResponseSchema);
    const modalOpen = shouldOpenNewClientModal(window.location.search);

    return { clients: payload.clients, modalOpen, modalError: null };
  },
  render: renderClients,
  bind(root, _data, repaint) {
    bindTableRows(root, repaint);
    bindNewClientModal(root, repaint);
  },
};
