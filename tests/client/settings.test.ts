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
});
