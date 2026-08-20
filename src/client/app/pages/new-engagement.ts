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
import { newClientFields } from "../components/new-client-fields.ts";
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
  itemsLoadedFor?: FilingType;
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

let persistedDraft: NewEngagementModalState | undefined;

export function rememberNewEngagementDraft(state: NewEngagementModalState): void {
  persistedDraft = state;
}

export function clearNewEngagementDraft(): void {
  persistedDraft = undefined;
}

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
    mode: clients.length === 0 ? "new" : "existing",
    selectedClientId: opts.selectedClientId ?? clients[0]?.id ?? "",
    taxYear: 2025,
    filingType: opts.template?.filingType ?? "1120-S",
    clients,
    documentTypes,
    items: opts.template?.items.map((item) => ({ ...item })) ?? [],
    itemsLoadedFor: opts.template?.filingType,
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
    <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-engagement-title">
      <h2 class="modal-title" id="new-engagement-title">Create engagement</h2>
      ${state.error ? `<p class="load-error-message">${escapeHtml(state.error)}</p>` : ""}
      ${body}
    </section>
  </div>`;
}

function renderDetailsStep(state: NewEngagementModalState): string {
  const selectedClientId = state.selectedClientId;
  const hasClients = state.clients.length > 0;
  const creatingClient = !hasClients || state.mode === "new";

  return `<form class="form-grid" data-new-engagement-step="1">
    ${
      hasClients
        ? `<label class="form-field">
      <span class="form-label">Client</span>
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
    <fieldset class="form-field">
      <legend class="form-label">Client mode</legend>
      <label><input type="radio" name="mode" value="existing" ${
        state.mode === "existing" ? "checked" : ""
      } /> Use selected client</label>
      <label><input type="radio" name="mode" value="new" ${
        state.mode === "new" ? "checked" : ""
      } /> Create new client</label>
    </fieldset>`
        : `<p class="form-hint" data-no-clients>No clients yet. Create one to start this engagement.</p>
    <input type="hidden" name="mode" value="new" />`
    }
    <label class="form-field">
      <span class="form-label">Tax year</span>
      <input name="taxYear" type="number" min="2000" max="2100" value="${state.taxYear}" />
    </label>
    <fieldset class="form-field">
      <legend class="form-label">Filing type</legend>
      ${(["1120-S", "1065"] as const)
        .map(
          (filingType) =>
            `<label><input type="radio" name="filingType" value="${filingType}" ${
              state.filingType === filingType ? "checked" : ""
            } /> ${filingType}</label>`,
        )
        .join("")}
    </fieldset>
    ${
      creatingClient
        ? `<fieldset>
      <legend class="form-label">Create new client</legend>
      ${newClientFields(state.newClient)}
    </fieldset>`
        : ""
    }
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close-new-engagement>Cancel</button>
      <button class="btn-primary" type="button" data-new-engagement-next>Continue</button>
    </div>
  </form>`;
}

function renderChecklistStep(state: NewEngagementModalState): string {
  return `<form class="form-grid" data-new-engagement-step="2">
    <h3 class="section-title">Request checklist</h3>
    <div class="row-list">
      ${state.items.map((item, index) => renderChecklistItem(state, item, index)).join("")}
    </div>
    <button class="btn-secondary" type="button" data-add-request-item>Add item</button>
    <div class="modal-actions">
      <button class="btn-secondary" type="button" data-close-new-engagement>Cancel</button>
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
      <label class="form-field"><span class="form-label">Title</span><input name="title-${index}" value="${escapeHtml(
        item.title,
      )}" /></label>
      <label class="form-field"><span class="form-label">Description</span><input name="description-${index}" value="${escapeHtml(
        item.description,
      )}" /></label>
      <label class="form-field"><span class="form-label">Document type</span><select name="documentTypeId-${index}">
        ${documentTypes
          .map(
            (type) =>
              `<option value="${escapeHtml(type.id)}" ${
                type.id === item.documentTypeId ? "selected" : ""
              }>${escapeHtml(type.name)}</option>`,
          )
          .join("")}
      </select></label>
      <label class="form-field"><input type="checkbox" name="required-${index}" ${item.required ? "checked" : ""} /> Required</label>
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

export function applyDetailsDraft(state: NewEngagementModalState, form: FormData): NewEngagementModalState {
  const filingType = valueFrom(form, "filingType");
  const parsedYear = Number(valueFrom(form, "taxYear"));
  const mode = state.clients.length === 0 || valueFrom(form, "mode") === "new" ? "new" : "existing";
  const entityType = createClientInputSchema.shape.entityType.safeParse(valueFrom(form, "entityType"));
  return {
    ...state,
    mode,
    selectedClientId: valueFrom(form, "clientId") || state.selectedClientId,
    taxYear: Number.isFinite(parsedYear) ? parsedYear : state.taxYear,
    filingType: filingType === "1065" ? "1065" : filingType === "1120-S" ? "1120-S" : state.filingType,
    newClient:
      mode === "new"
        ? {
            legalName: valueFrom(form, "legalName"),
            entityType: entityType.success
              ? entityType.data
              : (state.newClient?.entityType ?? "s-corp"),
            ein: valueFrom(form, "ein"),
            contactName: valueFrom(form, "contactName"),
            contactEmail: valueFrom(form, "contactEmail"),
            city: valueFrom(form, "city"),
            state: valueFrom(form, "state"),
          }
        : state.newClient,
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

export async function advanceToChecklist(
  current: NewEngagementModalState,
  next: NewEngagementModalState,
): Promise<NewEngagementModalState> {
  const loadedFor = current.itemsLoadedFor;
  if (loadedFor === next.filingType && current.items.length > 0) {
    return { ...next, step: 2, items: current.items, itemsLoadedFor: loadedFor, error: undefined };
  }

  const items = await loadTemplateItemsForFilingType(next.filingType);
  return { ...next, step: 2, items, itemsLoadedFor: next.filingType, error: undefined };
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
    rememberNewEngagementDraft(next);
    opts.setState(next);
  };
  const renderCurrent = () => {
    const currentModal = root.querySelector<HTMLElement>("[data-new-engagement-modal]");
    if (currentModal) {
      currentModal.outerHTML = renderNewEngagementModal(currentState);
    }
  };

  const closeModal = () => {
    const currentModal = root.querySelector<HTMLElement>("[data-new-engagement-modal]");
    currentModal?.setAttribute("hidden", "");
    clearNewEngagementDraft();
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      window.history.replaceState({}, "", "/engagements");
    }
  };

  const persistOpenDraft = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const currentModal = root.querySelector<HTMLElement>("[data-new-engagement-modal]");
    if (!currentModal || currentModal.hasAttribute("hidden") || !currentModal.contains(target)) {
      return;
    }

    const detailsForm = target.closest<HTMLFormElement>("[data-new-engagement-step='1']");
    if (detailsForm) {
      const next = applyDetailsDraft(currentState, new FormData(detailsForm));
      const modeChanged = next.mode !== currentState.mode;
      setState(next);
      if (modeChanged) {
        renderCurrent();
      }
      return;
    }

    if (currentModal.querySelector("[data-new-engagement-step='2']")) {
      setState(stateFromStepTwo(currentState, currentModal));
    }
  };

  root.addEventListener("input", persistOpenDraft);
  root.addEventListener("change", persistOpenDraft);

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches("[data-close-new-engagement]") || target.matches("[data-new-engagement-modal]")) {
      closeModal();
      return;
    }

    if (target.matches("[data-new-engagement-next]")) {
      const form = target.closest("form");
      if (!form) return;
      const next = applyDetailsDraft(currentState, new FormData(form));
      void advanceToChecklist(currentState, next)
        .then((advanced) => {
          setState(advanced);
          writeModalQuery(advanced.filingType);
          renderCurrent();
        })
        .catch((error: unknown) => {
          setState({ ...next, error: error instanceof Error ? error.message : String(error) });
          renderCurrent();
        });
    }

    if (target.matches("[data-new-engagement-back]")) {
      setState({ ...currentState, step: 1 });
      renderCurrent();
    }

    if (target.matches("[data-add-request-item]")) {
      const currentModal = root.querySelector<HTMLElement>("[data-new-engagement-modal]");
      if (!currentModal) return;
      setState(addItem(stateFromStepTwo(currentState, currentModal)));
      renderCurrent();
    }

    const removeIndex = target.getAttribute("data-remove-request-item");
    if (removeIndex !== null) {
      const currentModal = root.querySelector<HTMLElement>("[data-new-engagement-modal]");
      if (!currentModal) return;
      setState(removeItem(stateFromStepTwo(currentState, currentModal), Number(removeIndex)));
      renderCurrent();
    }

    if (target.matches("[data-create-engagement]")) {
      const currentModal = root.querySelector<HTMLElement>("[data-new-engagement-modal]");
      if (!currentModal) return;
      void createEngagementFromState(stateFromStepTwo(currentState, currentModal))
        .then((engagement) => {
          setState({
            ...currentState,
            step: "success",
            engagementId: engagement.id,
            portalToken: engagement.portalToken,
          });
          renderCurrent();
        })
        .catch((error: unknown) => {
          setState({
            ...currentState,
            error: error instanceof Error ? error.message : String(error),
          });
          renderCurrent();
        });
    }

    const portalHref = target.getAttribute("data-copy-portal-link");
    if (portalHref) {
      void navigator.clipboard?.writeText(new URL(portalHref, window.location.origin).toString());
    }
  });
}

function writeModalQuery(filingType: FilingType): void {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") !== "1") {
    return;
  }
  params.set("filingType", filingType);
  window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
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

export async function loadTemplateItemsForFilingType(
  filingType: FilingType,
): Promise<ChecklistItemDraft[]> {
  const templates = await getJson(
    `/api/request-templates?filingType=${encodeURIComponent(filingType)}`,
    requestTemplatesResponseSchema,
  );
  return templates.templates[0]?.items.map((item) => ({ ...item })) ?? [];
}

export async function loadNewEngagementState(
  selectedClientId?: string,
  filingType: FilingType = "1120-S",
): Promise<NewEngagementModalState> {
  if (persistedDraft) {
    return persistedDraft;
  }

  const [clients, documentTypes, items] = await Promise.all([
    getJson("/api/clients", clientListResponseSchema),
    getJson("/api/document-types", documentTypesResponseSchema),
    loadTemplateItemsForFilingType(filingType),
  ]);

  const state = initialNewEngagementState({
    clients: clients.clients,
    documentTypes: documentTypes.documentTypes,
    selectedClientId,
  });
  return { ...state, filingType, items, itemsLoadedFor: filingType };
}
