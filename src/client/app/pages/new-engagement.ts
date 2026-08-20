import { z } from "zod";
import { clientListResponseSchema } from "../../../shared/schemas/api.ts";
import {
  clientSchema,
  createClientInputSchema,
  type Client,
} from "../../../shared/schemas/client.ts";
import { documentTypeSchema, type DocumentType } from "../../../shared/schemas/document-type.ts";
import {
  createEngagementInputSchema,
  engagementSchema,
  type Engagement,
  type FilingType,
} from "../../../shared/schemas/engagement.ts";
import {
  createRequestItemInputSchema,
  requestTemplateSchema,
  type RequestTemplate,
} from "../../../shared/schemas/request.ts";
import { getJson, sendJson } from "../api.ts";
import { escapeHtml } from "../render.ts";

export type ChecklistItemDraft = {
  title: string;
  description: string;
  documentTypeId: string;
  required: boolean;
};

export type ClientOption = {
  id: string;
  legalName: string;
};

export type DocumentTypeOption = Pick<DocumentType, "id" | "name" | "active">;

export type NewClientDraft = z.infer<typeof createClientInputSchema>;

export type NewEngagementModalState = {
  step: 1 | 2 | "success";
  mode: "existing" | "new";
  selectedClientId: string;
  taxYear: number;
  filingType: FilingType;
  clients: ClientOption[];
  documentTypes: DocumentTypeOption[];
  items: ChecklistItemDraft[];
  newClient?: NewClientDraft;
  portalToken?: string;
  engagementId?: string;
  error?: string;
};

export const documentTypesResponseSchema = z.object({
  documentTypes: z.array(documentTypeSchema),
});

export const requestTemplatesResponseSchema = z.object({
  templates: z.array(requestTemplateSchema),
});

export const engagementCreateResponseSchema = z.object({
  engagement: engagementSchema,
});

export const clientCreateResponseSchema = z.object({
  client: clientSchema,
});

const createEngagementWithItemsInputSchema = createEngagementInputSchema.extend({
  items: z.array(createRequestItemInputSchema),
});

function emptyItem(documentTypes: DocumentTypeOption[]): ChecklistItemDraft {
  return {
    title: "",
    description: "",
    documentTypeId: documentTypes.find((type) => type.active)?.id ?? "",
    required: true,
  };
}

export function initialNewEngagementState(opts: {
  clients: Client[];
  documentTypes: DocumentType[];
  template?: RequestTemplate;
  selectedClientId?: string;
}): NewEngagementModalState {
  const clients = opts.clients.map((client) => ({ id: client.id, legalName: client.legalName }));
  const documentTypes = opts.documentTypes.map((type) => ({
    id: type.id,
    name: type.name,
    active: type.active,
  }));
  return {
    step: 1,
    mode: "existing",
    selectedClientId: opts.selectedClientId ?? clients[0]?.id ?? "",
    taxYear: 2025,
    filingType: opts.template?.filingType ?? "1120-S",
    clients,
    documentTypes,
    items: opts.template?.items.map((item) => ({ ...item })) ?? [],
    newClient: {
      legalName: "",
      entityType: "s-corp",
      ein: "",
      contactName: "",
      contactEmail: "",
      city: "",
      state: "",
    },
  };
}

export function addItem(state: NewEngagementModalState): NewEngagementModalState {
  return { ...state, items: [...state.items, emptyItem(state.documentTypes)] };
}

export function removeItem(state: NewEngagementModalState, index: number): NewEngagementModalState {
  return { ...state, items: state.items.filter((_item, itemIndex) => itemIndex !== index) };
}

export function updateItem(
  state: NewEngagementModalState,
  index: number,
  patch: Partial<ChecklistItemDraft>,
): NewEngagementModalState {
  return {
    ...state,
    items: state.items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    ),
  };
}

export function renderNewEngagementModal(state: NewEngagementModalState): string {
  const body =
    state.step === "success"
      ? renderSuccess(state)
      : state.step === 2
        ? renderChecklistStep(state)
        : renderDetailsStep(state);

  return `<div class="modal" data-new-engagement-modal>
    <section class="modal-panel" aria-labelledby="new-engagement-title">
      <h2 class="modal-title" id="new-engagement-title">Create engagement</h2>
      ${state.error ? `<p class="load-error-message">${escapeHtml(state.error)}</p>` : ""}
      ${body}
    </section>
  </div>`;
}

function renderDetailsStep(state: NewEngagementModalState): string {
  const selectedClientId = state.selectedClientId;

  return `<form data-new-engagement-step="1">
    <div class="definition-grid">
      <label>
        <span class="muted">Client</span>
        <select name="clientId">
          ${state.clients
            .map(
              (client) =>
                `<option value="${escapeHtml(client.id)}" ${
                  client.id === selectedClientId ? "selected" : ""
                }>${escapeHtml(client.legalName)}</option>`,
            )
            .join("")}
        </select>
      </label>
      <label>
        <span class="muted">Tax year</span>
        <input name="taxYear" type="number" min="2000" max="2100" value="${state.taxYear}" />
      </label>
    </div>
    <fieldset>
      <legend class="muted">Client mode</legend>
      <label><input type="radio" name="mode" value="existing" ${
        state.mode === "existing" ? "checked" : ""
      } /> Use selected client</label>
      <label><input type="radio" name="mode" value="new" ${
        state.mode === "new" ? "checked" : ""
      } /> Create new client</label>
    </fieldset>
    <fieldset>
      <legend class="muted">Filing type</legend>
      ${(["1120-S", "1065"] as const)
        .map(
          (filingType) =>
            `<label><input type="radio" name="filingType" value="${filingType}" ${
              state.filingType === filingType ? "checked" : ""
            } /> ${filingType}</label>`,
        )
        .join("")}
    </fieldset>
    <fieldset>
      <legend class="muted">Create new client</legend>
      <label><span class="muted">Legal name</span><input name="legalName" value="${escapeHtml(
        state.newClient?.legalName ?? "",
      )}" /></label>
      <label><span class="muted">Entity type</span><select name="entityType">
        ${["s-corp", "partnership", "c-corp", "llc"]
          .map(
            (entityType) =>
              `<option value="${entityType}" ${
                state.newClient?.entityType === entityType ? "selected" : ""
              }>${entityType}</option>`,
          )
          .join("")}
      </select></label>
      <label><span class="muted">EIN</span><input name="ein" value="${escapeHtml(
        state.newClient?.ein ?? "",
      )}" /></label>
      <label><span class="muted">Contact name</span><input name="contactName" value="${escapeHtml(
        state.newClient?.contactName ?? "",
      )}" /></label>
      <label><span class="muted">Contact email</span><input name="contactEmail" value="${escapeHtml(
        state.newClient?.contactEmail ?? "",
      )}" /></label>
      <label><span class="muted">City</span><input name="city" value="${escapeHtml(
        state.newClient?.city ?? "",
      )}" /></label>
      <label><span class="muted">State</span><input name="state" value="${escapeHtml(
        state.newClient?.state ?? "",
      )}" /></label>
    </fieldset>
    <div class="modal-actions">
      <button class="btn-primary" type="button" data-new-engagement-next>Continue</button>
    </div>
  </form>`;
}

function renderChecklistStep(state: NewEngagementModalState): string {
  return `<form data-new-engagement-step="2">
    <h3 class="section-title">Request checklist</h3>
    <div class="row-list">
      ${state.items.map((item, index) => renderChecklistItem(state, item, index)).join("")}
    </div>
    <button class="btn-secondary" type="button" data-add-request-item>Add item</button>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-new-engagement-back>Back</button>
      <button class="btn-primary" type="button" data-create-engagement>Create engagement</button>
    </div>
  </form>`;
}

function renderChecklistItem(
  state: NewEngagementModalState,
  item: ChecklistItemDraft,
  index: number,
): string {
  const documentTypes = state.documentTypes.filter((type) => type.active);
  return `<div class="list-row" data-checklist-index="${index}">
    <span class="list-row-body">
      <label><span class="muted">Title</span><input name="title-${index}" value="${escapeHtml(
        item.title,
      )}" /></label>
      <label><span class="muted">Description</span><input name="description-${index}" value="${escapeHtml(
        item.description,
      )}" /></label>
      <label><span class="muted">Document type</span><select name="documentTypeId-${index}">
        ${documentTypes
          .map(
            (type) =>
              `<option value="${escapeHtml(type.id)}" ${
                type.id === item.documentTypeId ? "selected" : ""
              }>${escapeHtml(type.name)}</option>`,
          )
          .join("")}
      </select></label>
      <label><input type="checkbox" name="required-${index}" ${item.required ? "checked" : ""} /> Required</label>
    </span>
    <button class="btn-ghost" type="button" data-remove-request-item="${index}">Remove</button>
  </div>`;
}

function renderSuccess(state: NewEngagementModalState): string {
  const token = state.portalToken ?? "";
  const engagementId = state.engagementId ?? "";
  const portalHref = `/portal/${encodeURIComponent(token)}`;

  return `<div data-new-engagement-success>
    <p class="wash-title">Request sent</p>
    <p class="muted">Portal link minted for the client.</p>
    <a class="text-link" href="${portalHref}" data-nav-link>${escapeHtml(portalHref)}</a>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-copy-portal-link="${portalHref}">Copy portal link</button>
      <a class="btn-primary" href="/engagements/${encodeURIComponent(engagementId)}" data-nav-link>Open engagement</a>
    </div>
  </div>`;
}

function valueFrom(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function stateFromStepOne(state: NewEngagementModalState, form: FormData): NewEngagementModalState {
  const filingType = valueFrom(form, "filingType");
  const mode = valueFrom(form, "mode");
  return {
    ...state,
    mode: mode === "new" ? "new" : "existing",
    selectedClientId: valueFrom(form, "clientId"),
    taxYear: Number(valueFrom(form, "taxYear")),
    filingType: filingType === "1065" ? "1065" : "1120-S",
    newClient: {
      legalName: valueFrom(form, "legalName"),
      entityType: createClientInputSchema.shape.entityType.parse(valueFrom(form, "entityType")),
      ein: valueFrom(form, "ein"),
      contactName: valueFrom(form, "contactName"),
      contactEmail: valueFrom(form, "contactEmail"),
      city: valueFrom(form, "city"),
      state: valueFrom(form, "state"),
    },
  };
}

function stateFromStepTwo(state: NewEngagementModalState, root: HTMLElement): NewEngagementModalState {
  const rows = [...root.querySelectorAll<HTMLElement>("[data-checklist-index]")];
  return {
    ...state,
    items: rows.map((row, index) => ({
      title: row.querySelector<HTMLInputElement>(`[name="title-${index}"]`)?.value ?? "",
      description: row.querySelector<HTMLInputElement>(`[name="description-${index}"]`)?.value ?? "",
      documentTypeId:
        row.querySelector<HTMLSelectElement>(`[name="documentTypeId-${index}"]`)?.value ?? "",
      required: row.querySelector<HTMLInputElement>(`[name="required-${index}"]`)?.checked ?? false,
    })),
  };
}

export function bindNewEngagementModal(
  root: HTMLElement,
  opts: {
    state: NewEngagementModalState;
    setState: (state: NewEngagementModalState) => void;
    repaint: () => void;
  },
): void {
  const modal = root.querySelector<HTMLElement>("[data-new-engagement-modal]");
  if (!modal) return;
  let currentState = opts.state;
  const setState = (next: NewEngagementModalState) => {
    currentState = next;
    opts.setState(next);
  };

  modal.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches("[data-new-engagement-next]")) {
      const form = target.closest("form");
      if (!form) return;
      setState({ ...stateFromStepOne(currentState, new FormData(form)), step: 2 });
      opts.repaint();
    }

    if (target.matches("[data-new-engagement-back]")) {
      setState({ ...currentState, step: 1 });
      opts.repaint();
    }

    if (target.matches("[data-add-request-item]")) {
      setState(addItem(stateFromStepTwo(currentState, modal)));
      opts.repaint();
    }

    const removeIndex = target.getAttribute("data-remove-request-item");
    if (removeIndex !== null) {
      setState(removeItem(stateFromStepTwo(currentState, modal), Number(removeIndex)));
      opts.repaint();
    }

    if (target.matches("[data-create-engagement]")) {
      void createEngagementFromState(stateFromStepTwo(currentState, modal))
        .then((engagement) => {
          setState({
            ...currentState,
            step: "success",
            engagementId: engagement.id,
            portalToken: engagement.portalToken,
          });
          opts.repaint();
        })
        .catch((error: unknown) => {
          setState({
            ...currentState,
            error: error instanceof Error ? error.message : String(error),
          });
          opts.repaint();
        });
    }

    const portalHref = target.getAttribute("data-copy-portal-link");
    if (portalHref) {
      void navigator.clipboard?.writeText(new URL(portalHref, window.location.origin).toString());
    }
  });
}

async function createEngagementFromState(state: NewEngagementModalState): Promise<Engagement> {
  let clientId = state.selectedClientId;
  if (state.mode === "new" && state.newClient) {
    const created = await sendJson("POST", "/api/clients", state.newClient, clientCreateResponseSchema);
    clientId = created.client.id;
  }

  const payload = createEngagementWithItemsInputSchema.parse({
    clientId,
    taxYear: state.taxYear,
    filingType: state.filingType,
    items: state.items,
  });
  const created = await sendJson("POST", "/api/engagements", payload, engagementCreateResponseSchema);
  return created.engagement;
}

export async function loadNewEngagementState(selectedClientId?: string): Promise<NewEngagementModalState> {
  const [clients, documentTypes, templates] = await Promise.all([
    getJson("/api/clients", clientListResponseSchema),
    getJson("/api/document-types", documentTypesResponseSchema),
    getJson("/api/request-templates?filingType=1120-S", requestTemplatesResponseSchema),
  ]);

  return initialNewEngagementState({
    clients: clients.clients,
    documentTypes: documentTypes.documentTypes,
    template: templates.templates[0],
    selectedClientId,
  });
}
