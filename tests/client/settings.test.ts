import { describe, expect, test } from "bun:test";
import {
  renderSettings,
  settingsPage,
  type SettingsData,
} from "../../src/client/app/pages/settings.ts";
import { documentTypeSchema, type DocumentType } from "../../src/shared/schemas/document-type.ts";

function documentType(overrides: Partial<DocumentType> = {}): DocumentType {
  return documentTypeSchema.parse({
    id: "dt-1",
    name: "Trial balance",
    description: "Year-end account balances.",
    active: true,
    createdBy: "seed",
    createdAt: "2026-08-19T18:00:00.000Z",
    fields: [
      {
        key: "account_name",
        label: "Account name",
        metadataType: "identifier",
        dataType: "string",
        required: true,
        description: "General ledger account name.",
      },
      {
        key: "ending_balance",
        label: "Ending balance",
        metadataType: "dollar-amount",
        dataType: "double",
        required: true,
        regex: "^-?\\d+(\\.\\d{2})?$",
        description: "Final balance for the account.",
      },
    ],
    ...overrides,
  });
}

function data(overrides: Partial<SettingsData> = {}): SettingsData {
  return {
    documentTypes: [documentType()],
    ...overrides,
  };
}

describe("settings page", () => {
  test("renders company profile health slots and the document type library", () => {
    const html = renderSettings(data());

    expect(html).toContain("Company profile");
    expect(html).toContain("Document types");
    expect(html).toContain("data-api-status");
    expect(html).toContain("data-db-status");
    expect(html).toContain("Trial balance");
    expect(html).toContain("Year-end account balances.");
    expect(html).toContain("2 fields");
    expect(html).toContain('class="chip chip-processing">seed</span>');
    expect(html).toContain('data-document-type-active="dt-1"');
    expect(html).toContain("New document type");
  });

  test("renders cpa-created definitions and escaped descriptions", () => {
    const html = renderSettings(
      data({
        documentTypes: [
          documentType({
            id: "dt-cpa",
            createdBy: "cpa",
            name: "State schedule",
            description: '<img src="x">',
            active: false,
          }),
        ],
      }),
    );

    expect(html).toContain('class="chip chip-success">cpa</span>');
    expect(html).toContain("&lt;img src=&quot;x&quot;&gt;");
    expect(html).not.toContain('<img src="x">');
    expect(html).toContain("Inactive");
  });

  test("loads document types through the shared API seam", async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch: typeof fetch = Object.assign(
      async () =>
        new Response(JSON.stringify({ documentTypes: [documentType()] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      { preconnect: originalFetch.preconnect },
    );
    globalThis.fetch = mockFetch;

    try {
      const loaded = await settingsPage.load({ page: "settings" });
      expect(loaded.documentTypes).toHaveLength(1);
      expect(loaded.documentTypes[0]?.name).toBe("Trial balance");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("clicking the active label does not open the schema builder", () => {
    const originalInput = globalThis.HTMLInputElement;
    globalThis.HTMLInputElement = FakeSettingsInput as unknown as typeof HTMLInputElement;
    const root = makeFakeSettingsRoot();

    try {
      settingsPage.bind?.(root as unknown as HTMLElement, data(), () => {});
      root.row.dispatch("click", root.statusText);

      expect(root.slot.innerHTML).toBe("");
    } finally {
      globalThis.HTMLInputElement = originalInput;
    }
  });

  test("open schema builder mounts a modal wash and keeps the draft when another edit starts", () => {
    const originalInput = globalThis.HTMLInputElement;
    globalThis.HTMLInputElement = FakeSettingsInput as unknown as typeof HTMLInputElement;
    const root = makeFakeSettingsRoot();

    try {
      settingsPage.bind?.(root as unknown as HTMLElement, data(), () => {});
      root.row.dispatch("click", root.row);

      expect(root.slot.innerHTML).toContain('class="modal"');
      expect(root.slot.innerHTML).toContain("Edit schema");

      root.newType.dispatch("click", root.newType);
      root.row.dispatch("click", root.row);

      expect(root.slot.innerHTML).toContain("Edit schema");
      expect(root.slot.innerHTML).not.toContain("New schema");
    } finally {
      globalThis.HTMLInputElement = originalInput;
    }
  });

  test("closing the schema builder allows a later open to mount a different draft", () => {
    const originalInput = globalThis.HTMLInputElement;
    globalThis.HTMLInputElement = FakeSettingsInput as unknown as typeof HTMLInputElement;
    const root = makeFakeSettingsRoot();

    try {
      settingsPage.bind?.(root as unknown as HTMLElement, data(), () => {});
      root.row.dispatch("click", root.row);
      expect(root.slot.innerHTML).toContain("Edit schema");

      root.slot.innerHTML = "";
      root.newType.dispatch("click", root.newType);

      expect(root.slot.innerHTML).toContain('class="modal"');
      expect(root.slot.innerHTML).toContain("New schema");
    } finally {
      globalThis.HTMLInputElement = originalInput;
    }
  });
});

type SettingsListener = (event: {
  target: FakeSettingsElement;
  key?: string;
  preventDefault(): void;
}) => void;

class FakeSettingsElement {
  dataset: Record<string, string | undefined> = {};
  innerHTML = "";
  parent: FakeSettingsElement | null = null;
  private readonly listeners = new Map<string, SettingsListener[]>();

  constructor(readonly selector: string) {}

  addEventListener(type: string, listener: SettingsListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, target: FakeSettingsElement, key?: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target, key, preventDefault() {} });
    }
  }

  closest(selector: string): FakeSettingsElement | null {
    if (selector === ".toggle-field" && this.parent?.selector === ".toggle-field") {
      return this.parent;
    }
    return null;
  }

  querySelector(selector: string): FakeSettingsElement | null {
    if (selector === ".side-panel" && this.innerHTML.includes("side-panel")) {
      return new FakeSettingsElement(".side-panel");
    }
    return null;
  }

  querySelectorAll(): FakeSettingsElement[] {
    return [];
  }
}

class FakeSettingsInput extends FakeSettingsElement {
  checked = false;
}

function makeFakeSettingsRoot() {
  const row = new FakeSettingsElement("[data-document-type-row]");
  row.dataset.documentTypeRow = "dt-1";
  const toggle = new FakeSettingsInput("[data-document-type-active]");
  toggle.dataset.documentTypeActive = "dt-1";
  const toggleLabel = new FakeSettingsElement(".toggle-field");
  const statusText = new FakeSettingsElement("span");
  statusText.parent = toggleLabel;
  const slot = new FakeSettingsElement("[data-schema-panel-slot]");
  const newType = new FakeSettingsElement("[data-new-document-type]");

  return {
    row,
    slot,
    statusText,
    newType,
    querySelector(selector: string) {
      if (selector === "[data-schema-panel-slot]") {
        return slot;
      }
      if (selector === "[data-new-document-type]") {
        return newType;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === "[data-document-type-active]") {
        return [toggle];
      }
      if (selector === "[data-document-type-row]") {
        return [row];
      }
      return [];
    },
  };
}
