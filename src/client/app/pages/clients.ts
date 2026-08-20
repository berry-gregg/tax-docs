import { z } from "zod";
import {
  clientListResponseSchema,
} from "../../../shared/schemas/api.ts";
import {
  clientSchema,
  createClientInputSchema,
  type Client,
} from "../../../shared/schemas/client.ts";
import { ApiError, getJson, sendJson } from "../api.ts";
import { entityTypeLabels, newClientFields } from "../components/new-client-fields.ts";
import {
  bindRowLinks,
  dataTable,
  entityCell,
  escapeHtml,
  initialsFor,
  pageHeader,
} from "../render.ts";
import type { PageModule } from "./registry.ts";

const createClientResponseSchema = z.object({ client: clientSchema });

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
        ${newClientFields()}
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
    bindRowLinks(root, repaint);
    bindNewClientModal(root, repaint);
  },
};
