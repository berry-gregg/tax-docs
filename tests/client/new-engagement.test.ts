import { describe, expect, test } from "bun:test";
import {
  addItem,
  removeItem,
  renderNewEngagementModal,
  updateItem,
  type NewEngagementModalState,
} from "../../src/client/app/pages/new-engagement.ts";

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
});
