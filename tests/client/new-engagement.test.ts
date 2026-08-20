import { afterEach, describe, expect, test } from "bun:test";
import {
  addItem,
  clearNewEngagementDraft,
  loadNewEngagementState,
  removeItem,
  renderNewEngagementModal,
  updateItem,
  type NewEngagementModalState,
} from "../../src/client/app/pages/new-engagement.ts";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function documentType(id: string, name: string) {
  return {
    id,
    name,
    description: `${name} description`,
    active: true,
    createdBy: "seed",
    fields: [
      {
        key: "amount",
        label: "Amount",
        metadataType: "dollar-amount",
        dataType: "double",
        required: true,
        description: "Amount.",
      },
    ],
    createdAt: "2026-08-19T18:00:00.000Z",
  };
}

function stubModalFetch(): string[] {
  const urls: string[] = [];
  const mockFetch: typeof fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url === "/api/clients") {
        return jsonResponse({
          clients: [
            {
              id: "client-1",
              legalName: "Northwind Partners LLC",
              entityType: "s-corp",
              ein: "12-3456789",
              contactName: "Nora North",
              contactEmail: "nora@example.com",
              city: "Denver",
              state: "CO",
              createdAt: "2026-08-19T18:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/document-types") {
        return jsonResponse({ documentTypes: [documentType("dt-1120s", "1120-S K-1"), documentType("dt-1065", "1065 K-1")] });
      }
      if (url.includes("filingType=1065")) {
        return jsonResponse({
          templates: [
            {
              id: "template-1065",
              filingType: "1065",
              items: [
                {
                  title: "1065 K-1 package",
                  description: "Partnership K-1s.",
                  documentTypeId: "dt-1065",
                  required: true,
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({
        templates: [
          {
            id: "template-1120s",
            filingType: "1120-S",
            items: [
              {
                title: "1120-S K-1 package",
                description: "Shareholder K-1s.",
                documentTypeId: "dt-1120s",
                required: true,
              },
            ],
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = mockFetch;
  return urls;
}

afterEach(() => {
  clearNewEngagementDraft();
  globalThis.fetch = originalFetch;
});

function state(overrides: Partial<NewEngagementModalState> = {}): NewEngagementModalState {
  return {
    step: 1,
    mode: "existing",
    selectedClientId: "client-1",
    taxYear: 2025,
    filingType: "1120-S",
    clients: [
      { id: "client-1", legalName: "Northwind Partners LLC" },
      { id: "client-2", legalName: "Blue River Foods" },
    ],
    documentTypes: [
      { id: "dt-k1", name: "K-1 (1120-S)", active: true },
      { id: "dt-inactive", name: "Old worksheet", active: false },
    ],
    items: [
      {
        title: "Schedule K-1",
        description: "Upload every shareholder K-1.",
        documentTypeId: "dt-k1",
        required: true,
      },
    ],
    ...overrides,
  };
}

describe("new-engagement modal", () => {
  test("step 1 chooses an existing client or creates one inline with filing details", () => {
    const html = renderNewEngagementModal(state());

    expect(html).toContain('data-new-engagement-modal');
    expect(html).toContain("Create engagement");
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("Create new client");
    expect(html).toContain("Legal name");
    expect(html).toContain("Contact email");
    expect(html).toContain('value="2025"');
    expect(html).toContain("1120-S");
    expect(html).toContain("1065");
  });

  test("step 2 renders the editable template checklist and active document-type choices", () => {
    const html = renderNewEngagementModal(state({ step: 2 }));

    expect(html).toContain("Request checklist");
    expect(html).toContain("Schedule K-1");
    expect(html).toContain("Upload every shareholder K-1.");
    expect(html).toContain("Required");
    expect(html).toContain("Remove");
    expect(html).toContain("Add item");
    expect(html).toContain("K-1 (1120-S)");
    expect(html).not.toContain("Old worksheet");
  });

  test("checklist editor functions add, remove, and update without mutating state", () => {
    const initial = state({ step: 2 });
    const added = addItem(initial);
    const updated = updateItem(added, 1, {
      title: "Trial balance",
      description: "Final year-end trial balance.",
      documentTypeId: "dt-k1",
      required: false,
    });
    const removed = removeItem(updated, 0);

    expect(initial.items).toHaveLength(1);
    expect(added.items).toHaveLength(2);
    expect(updated.items[1]).toEqual({
      title: "Trial balance",
      description: "Final year-end trial balance.",
      documentTypeId: "dt-k1",
      required: false,
    });
    expect(removed.items).toEqual([updated.items[1]]);
  });

  test("success panel shows the minted portal link and workspace action", () => {
    const html = renderNewEngagementModal(
      state({ step: "success", portalToken: "portal-token", engagementId: "eng-1" }),
    );

    expect(html).toContain("/portal/portal-token");
    expect(html).toContain("Copy portal link");
    expect(html).toContain("Open engagement");
    expect(html).toContain('href="/engagements/eng-1"');
  });

  test("loads the request template for the selected filing type", async () => {
    const urls = stubModalFetch();

    const loaded = await loadNewEngagementState(undefined, "1065");

    expect(urls).toContain("/api/request-templates?filingType=1065");
    expect(loaded.filingType).toBe("1065");
    expect(loaded.items[0]?.title).toBe("1065 K-1 package");
  });

  test("can restore a step 2 draft after the shell does a full page load", async () => {
    stubModalFetch();
    const module = await import("../../src/client/app/pages/new-engagement.ts");
    const rememberDraft = "rememberNewEngagementDraft" in module ? module.rememberNewEngagementDraft : undefined;
    const clearDraft = "clearNewEngagementDraft" in module ? module.clearNewEngagementDraft : undefined;

    expect(typeof rememberDraft).toBe("function");
    expect(typeof clearDraft).toBe("function");
    if (typeof rememberDraft !== "function" || typeof clearDraft !== "function") return;

    const draft = state({ step: 2, filingType: "1065", items: [{ ...state().items[0]!, title: "Edited K-1" }] });
    rememberDraft(draft);
    const reloaded = await loadNewEngagementState(undefined, "1065");
    clearDraft();

    expect(reloaded.step).toBe(2);
    expect(reloaded.filingType).toBe("1065");
    expect(reloaded.items[0]?.title).toBe("Edited K-1");
  });
});
