import {
  defaultDataTypeFor,
  metadataTypeSchema,
  dataTypeSchema,
  type DataType,
  type FieldDef,
  type MetadataType,
} from "../../../shared/schemas/metadata.ts";
import {
  createDocumentTypeInputSchema,
  type CreateDocumentTypeInput,
} from "../../../shared/schemas/document-type.ts";
import { escapeHtml } from "../render.ts";

type FieldInputName = "key" | "label" | "metadataType" | "dataType" | "regex" | "description";

const metadataTypes = metadataTypeSchema.options;
const dataTypes = dataTypeSchema.options;

export function emptyField(): FieldDef {
  return {
    key: "",
    label: "",
    metadataType: "free-text",
    dataType: defaultDataTypeFor("free-text"),
    required: false,
    description: "",
  };
}

export function renderSchemaBuilder(draft: CreateDocumentTypeInput | null): string {
  const input = draft ?? {
    name: "",
    description: "",
    active: true,
    fields: [emptyField()],
  };

  return `<aside class="side-panel" aria-label="Document type schema builder">
    <form class="schema-builder" data-schema-form novalidate>
      <div class="side-panel-head">
        <div>
          <p class="eyebrow">Document type</p>
          <h2 class="modal-title">${draft ? "Edit schema" : "New schema"}</h2>
        </div>
        <button class="btn-secondary" type="button" data-schema-close>Close</button>
      </div>
      <div class="side-panel-body">
        <label class="form-field">
          <span>Name</span>
          <input name="name" data-schema-input="name" value="${escapeHtml(input.name)}" />
          <span class="field-issue" data-schema-issue="name"></span>
        </label>
        <label class="form-field">
          <span>Description</span>
          <textarea name="description" data-schema-input="description">${escapeHtml(input.description)}</textarea>
          <span class="field-issue" data-schema-issue="description"></span>
        </label>
        <div class="schema-fields">
          <div class="schema-fields-head">
            <h3 class="section-title">Fields</h3>
            <button class="btn-ghost" type="button" data-add-field>Add field</button>
          </div>
          <p class="muted">Use snake_case keys. Metadata type chooses a data type default; override it when needed.</p>
          <div class="field-list" data-field-list>
            ${input.fields.map(renderFieldRow).join("")}
          </div>
          <span class="field-issue" data-schema-issue="fields"></span>
        </div>
      </div>
      <div class="side-panel-foot">
        <span class="field-issue schema-form-issue" data-schema-form-error></span>
        <button class="btn-secondary" type="button" data-schema-close>Cancel</button>
        <button class="btn-primary" type="submit">Save</button>
      </div>
    </form>
  </aside>`;
}

export function bindSchemaBuilder(
  root: HTMLElement,
  opts: { onSave(input: CreateDocumentTypeInput): void; onClose(): void },
): void {
  root.querySelectorAll<HTMLElement>("[data-schema-close]").forEach((button) => {
    button.addEventListener("click", opts.onClose);
  });

  root.querySelector<HTMLElement>("[data-add-field]")?.addEventListener("click", () => {
    const list = root.querySelector<HTMLElement>("[data-field-list]");
    const index = root.querySelectorAll("[data-field-row]").length;
    list?.insertAdjacentHTML("beforeend", renderFieldRow(emptyField(), index));
    bindFieldRows(root);
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest<HTMLElement>("[data-remove-field]");
    if (!remove) {
      return;
    }

    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-field-row]"));
    if (rows.length <= 1) {
      setIssue(rows[0] ?? root, "key", "At least one field is required.");
      return;
    }

    remove.closest("[data-field-row]")?.remove();
  });

  root.addEventListener("change", (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (target?.dataset.fieldInput === "metadataType") {
      applyMetadataDefault(target);
    }
  });

  bindFieldRows(root);

  root.querySelector<HTMLFormElement>("[data-schema-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    clearIssues(root);

    const parsed = createDocumentTypeInputSchema.safeParse(readInput(root));
    if (!parsed.success) {
      showParseIssues(root, parsed.error.issues);
      return;
    }

    opts.onSave(parsed.data);
  });
}

function bindFieldRows(root: ParentNode): void {
  root.querySelectorAll<HTMLSelectElement>('[data-field-input="metadataType"]').forEach((select) => {
    if (select.dataset.boundMetadata === "true") {
      return;
    }
    select.dataset.boundMetadata = "true";
    select.addEventListener("change", () => applyMetadataDefault(select));
  });

  root.querySelectorAll<HTMLInputElement>('[data-field-input="regex"]').forEach((input) => {
    if (input.dataset.boundRegex === "true") {
      return;
    }
    input.dataset.boundRegex = "true";
    input.addEventListener("blur", () => validateRegexInput(input));
  });
}

function renderFieldRow(field: FieldDef, index: number): string {
  return `<fieldset class="schema-field-row" data-field-row>
    <div class="schema-row-head">
      <legend>Field ${index + 1}</legend>
      <button class="btn-ghost" type="button" data-remove-field>Remove row</button>
    </div>
    <label class="form-field">
      <span>Key <span class="muted">snake_case</span></span>
      <input name="fields.${index}.key" data-field-input="key" value="${escapeHtml(field.key)}" />
      <span class="field-issue" data-field-issue="key"></span>
    </label>
    <label class="form-field">
      <span>Label</span>
      <input name="fields.${index}.label" data-field-input="label" value="${escapeHtml(field.label)}" />
      <span class="field-issue" data-field-issue="label"></span>
    </label>
    <div class="schema-field-grid">
      <label class="form-field">
        <span>Metadata type</span>
        <select name="fields.${index}.metadataType" data-field-input="metadataType">
          ${metadataTypes.map((type) => option(type, field.metadataType)).join("")}
        </select>
        <span class="field-issue" data-field-issue="metadataType"></span>
      </label>
      <label class="form-field">
        <span>Data type</span>
        <select name="fields.${index}.dataType" data-field-input="dataType">
          ${dataTypes.map((type) => option(type, field.dataType)).join("")}
        </select>
        <span class="field-issue" data-field-issue="dataType"></span>
      </label>
    </div>
    <label class="check-field">
      <input type="checkbox" name="fields.${index}.required" data-field-input="required" ${field.required ? "checked" : ""} />
      <span>Required</span>
    </label>
    <label class="form-field">
      <span>Regex <span class="muted">optional</span></span>
      <input name="fields.${index}.regex" data-field-input="regex" value="${escapeHtml(field.regex ?? "")}" />
      <span class="field-issue" data-field-issue="regex"></span>
    </label>
    <label class="form-field">
      <span>Description</span>
      <textarea name="fields.${index}.description" data-field-input="description">${escapeHtml(field.description)}</textarea>
      <span class="field-issue" data-field-issue="description"></span>
    </label>
  </fieldset>`;
}

function option<T extends string>(value: T, selected: T): string {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`;
}

function applyMetadataDefault(select: HTMLSelectElement): void {
  const parsed = metadataTypeSchema.safeParse(select.value);
  const row = select.closest<HTMLElement>("[data-field-row]");
  const dataType = row?.querySelector<HTMLSelectElement>('[data-field-input="dataType"]');
  if (!parsed.success || !dataType) {
    return;
  }

  dataType.value = defaultDataTypeFor(parsed.data);
}

function validateRegexInput(input: HTMLInputElement): void {
  const value = input.value.trim();
  const row = input.closest<HTMLElement>("[data-field-row]");
  if (value.length === 0) {
    setIssue(row ?? input, "regex", "");
    return;
  }

  try {
    new RegExp(value);
    setIssue(row ?? input, "regex", "");
  } catch {
    setIssue(row ?? input, "regex", "Regex must compile as a RegExp.");
  }
}

function readInput(root: ParentNode): unknown {
  return {
    name: readSchemaValue(root, "name"),
    description: readSchemaValue(root, "description"),
    active: true,
    fields: Array.from(root.querySelectorAll<HTMLElement>("[data-field-row]")).map(readField),
  };
}

function readSchemaValue(root: ParentNode, name: "name" | "description"): string {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-schema-input="${name}"]`)?.value.trim() ?? "";
}

function readField(row: HTMLElement): unknown {
  const metadataType = readFieldValue(row, "metadataType") as MetadataType;
  const dataType = readFieldValue(row, "dataType") as DataType;
  const regex = readFieldValue(row, "regex");
  const candidate = {
    key: readFieldValue(row, "key"),
    label: readFieldValue(row, "label"),
    metadataType,
    dataType,
    required: Boolean(row.querySelector<HTMLInputElement>('[data-field-input="required"]')?.checked),
    ...(regex.length > 0 ? { regex } : {}),
    description: readFieldValue(row, "description"),
  };

  return candidate;
}

function readFieldValue(row: ParentNode, name: FieldInputName): string {
  return row.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[data-field-input="${name}"]`,
  )?.value.trim() ?? "";
}

function clearIssues(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-schema-issue], [data-field-issue], [data-schema-form-error]").forEach(
    (issue) => {
      issue.textContent = "";
    },
  );
}

function showParseIssues(root: ParentNode, issues: { path: (string | number)[]; message: string }[]): void {
  for (const issue of issues) {
    const [head, index, fieldName] = issue.path;
    if (head === "fields" && typeof index === "number" && typeof fieldName === "string") {
      const row = root.querySelectorAll<HTMLElement>("[data-field-row]")[index];
      setIssue(row ?? root, fieldName, issue.message);
      continue;
    }

    if (typeof head === "string") {
      setSchemaIssue(root, head, issue.message);
      continue;
    }

    const formError = root.querySelector<HTMLElement>("[data-schema-form-error]");
    if (formError) {
      formError.textContent = issue.message;
    }
  }
}

function setSchemaIssue(root: ParentNode, name: string, message: string): void {
  const target = root.querySelector<HTMLElement>(`[data-schema-issue="${name}"]`);
  if (target) {
    target.textContent = message;
  }
}

function setIssue(scope: ParentNode, name: string, message: string): void {
  const target = scope.querySelector<HTMLElement>(`[data-field-issue="${name}"]`);
  if (target) {
    target.textContent = message;
  }
}
