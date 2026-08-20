import { describe, expect, test } from "bun:test";
import {
  bindSchemaBuilder,
  emptyField,
  renderSchemaBuilder,
} from "../../src/client/app/components/schema-builder.ts";
import type { CreateDocumentTypeInput } from "../../src/shared/schemas/document-type.ts";

const draft: CreateDocumentTypeInput = {
  name: "State apportionment schedule",
  description: "Allocates revenue and payroll by state.",
  active: true,
  fields: [
    {
      key: "state_code",
      label: "State code",
      metadataType: "identifier",
      dataType: "string",
      required: true,
      regex: "^[A-Z]{2}$",
      description: "Two-letter state abbreviation.",
    },
    {
      key: "state_receipts",
      label: "State receipts",
      metadataType: "dollar-amount",
      dataType: "double",
      required: false,
      description: "Receipts assigned to the state.",
    },
  ],
};

describe("schema builder", () => {
  test("emptyField defaults to a free-text string row", () => {
    expect(emptyField()).toEqual({
      key: "",
      label: "",
      metadataType: "free-text",
      dataType: "string",
      required: false,
      description: "",
    });
  });

  test("renders rows from a draft in the side panel contract", () => {
    const html = renderSchemaBuilder(draft);

    expect(html).toContain('class="side-panel"');
    expect(html).toContain("State apportionment schedule");
    expect(html).toContain('name="fields.0.key"');
    expect(html).toContain('value="state_code"');
    expect(html).toContain('name="fields.1.key"');
    expect(html).toContain('value="state_receipts"');
    expect(html).toContain('value="dollar-amount" selected');
    expect(html).toContain('value="double" selected');
    expect(html).toContain("snake_case");
    // Required uses the shared drawn-checkbox recipe, not a bare native checkbox.
    expect(html).toContain('class="checkbox"');
    expect(html).toContain('class="checkbox-box"');
    expect(html).not.toContain('class="check-field"');
  });

  test("metadataType changes re-default the dataType while still allowing overrides", () => {
    const row = makeFakeRow();
    const root = makeFakeRoot(row);
    bindSchemaBuilder(root as unknown as HTMLElement, { onSave() {}, onClose() {} });

    row.metadata.value = "boolean-flag";
    row.metadata.dispatch("change");
    expect(row.dataType.value).toBe("boolean");

    row.dataType.value = "string";
    expect(row.dataType.value).toBe("string");
  });

  test("invalid regex blur shows an inline issue", () => {
    const row = makeFakeRow();
    const root = makeFakeRoot(row);
    bindSchemaBuilder(root as unknown as HTMLElement, { onSave() {}, onClose() {} });

    row.regex.value = "[";
    row.regex.dispatch("blur");

    expect(row.regexIssue.textContent).toContain("must compile");
  });

  test("inactive draft stays inactive after builder save", () => {
    const root = makeFakeSubmitRoot("false");
    const saved: CreateDocumentTypeInput[] = [];
    bindSchemaBuilder(root as unknown as HTMLElement, {
      onSave(input) {
        saved.push(input);
      },
      onClose() {},
    });

    root.form.dispatch("submit");

    expect(saved[0]?.active).toBe(false);
  });
});

type Listener = (event: { target: FakeElement; preventDefault(): void }) => void;

class FakeElement {
  value = "";
  textContent = "";
  checked = false;
  hidden = false;
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  dataset: Record<string, string | undefined> = {};
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly selector: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, preventDefault() {} });
    }
  }

  closest(selector: string): FakeElement | null {
    if (selector === "[data-field-row]") {
      return this.parent;
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    if (this.selector === selector) {
      return this;
    }
    return this.children.find((child) => child.selector === selector) ?? null;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }
}

function makeFakeRow() {
  const row = new FakeElement("[data-field-row]");
  const metadata = new FakeElement('[data-field-input="metadataType"]');
  const dataType = new FakeElement('[data-field-input="dataType"]');
  const regex = new FakeElement('[data-field-input="regex"]');
  const regexIssue = new FakeElement('[data-field-issue="regex"]');
  metadata.parent = row;
  dataType.parent = row;
  regex.parent = row;
  regexIssue.parent = row;
  row.children = [metadata, dataType, regex, regexIssue];

  return {
    row,
    metadata,
    dataType,
    regex,
    regexIssue,
  };
}

function makeFakeRoot(row: ReturnType<typeof makeFakeRow>) {
  return {
    querySelectorAll(selector: string) {
      if (selector === "[data-field-row]") {
        return [row.row];
      }
      if (selector === '[data-field-input="metadataType"]') {
        return [row.metadata];
      }
      if (selector === '[data-field-input="regex"]') {
        return [row.regex];
      }
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
  };
}

function makeFakeSubmitRoot(active: "true" | "false") {
  const form = new FakeElement("[data-schema-form]");
  const name = new FakeElement('[data-schema-input="name"]');
  const description = new FakeElement('[data-schema-input="description"]');
  const activeInput = new FakeElement('[data-schema-input="active"]');
  const row = new FakeElement("[data-field-row]");
  const key = new FakeElement('[data-field-input="key"]');
  const label = new FakeElement('[data-field-input="label"]');
  const metadata = new FakeElement('[data-field-input="metadataType"]');
  const dataType = new FakeElement('[data-field-input="dataType"]');
  const required = new FakeElement('[data-field-input="required"]');
  const regex = new FakeElement('[data-field-input="regex"]');
  const fieldDescription = new FakeElement('[data-field-input="description"]');

  name.value = "Inactive schedule";
  description.value = "A disabled but editable schema.";
  activeInput.value = active;
  key.value = "state_code";
  label.value = "State code";
  metadata.value = "identifier";
  dataType.value = "string";
  required.checked = true;
  fieldDescription.value = "Two-letter state abbreviation.";
  row.children = [key, label, metadata, dataType, required, regex, fieldDescription];

  return {
    form,
    querySelector(selector: string) {
      if (selector === "[data-schema-form]") {
        return form;
      }
      if (selector === '[data-schema-input="name"]') {
        return name;
      }
      if (selector === '[data-schema-input="description"]') {
        return description;
      }
      if (selector === '[data-schema-input="active"]') {
        return activeInput;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === "[data-field-row]") {
        return [row];
      }
      if (selector === '[data-field-input="metadataType"]') {
        return [metadata];
      }
      if (selector === '[data-field-input="regex"]') {
        return [regex];
      }
      return [];
    },
    addEventListener() {},
  };
}
