import { describe, expect, test } from "bun:test";
import {
  renderClientDetail,
  type ClientDetailData,
} from "../../src/client/app/pages/client-detail.ts";
import {
  clientsPage,
  renderClients,
  type ClientsData,
} from "../../src/client/app/pages/clients.ts";
import { clientSchema } from "../../src/shared/schemas/client.ts";
import { engagementSchema } from "../../src/shared/schemas/engagement.ts";

const client = clientSchema.parse({
  id: "client-1",
  legalName: "Northwind Partners LLC",
  entityType: "s-corp",
  ein: "12-3456789",
  contactName: "Alex Rivera",
  contactEmail: "alex@northwind.example",
  city: "Seattle",
  state: "WA",
  createdAt: "2026-08-19T12:00:00.000Z",
});

const engagement = engagementSchema.parse({
  id: "eng-1",
  clientId: "client-1",
  taxYear: 2025,
  filingType: "1120-S",
  status: "in-review",
  portalToken: "portal-token-1",
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:00:00.000Z",
});

function clientsData(overrides: Partial<ClientsData> = {}): ClientsData {
  return { clients: [client], modalOpen: false, modalError: null, ...overrides };
}

function detailData(overrides: Partial<ClientDetailData> = {}): ClientDetailData {
  return { client, engagements: [engagement], ...overrides };
}

describe("clients page", () => {
  test("new client modal includes every required field", () => {
    const html = renderClients(clientsData({ modalOpen: true }));

    expect(html).toContain('data-new-client-modal');
    expect(html).toContain('name="legalName"');
    expect(html).toContain('name="entityType"');
    expect(html).toContain('name="ein"');
    expect(html).toContain("XX-XXXXXXX");
    expect(html).toContain('name="contactName"');
    expect(html).toContain('name="contactEmail"');
    expect(html).toContain('name="city"');
    expect(html).toContain('name="state"');
    expect(html).toContain('data-submit-new-client');
  });

  test("modal shows server validation errors verbatim", () => {
    const html = renderClients(
      clientsData({ modalOpen: true, modalError: "String must contain at least 1 character(s)" }),
    );

    expect(html).toContain("String must contain at least 1 character(s)");
    expect(html).toContain('class="modal-error"');
  });

  test("client list rows deep-link to client detail", () => {
    const html = renderClients(clientsData());

    expect(html).toContain('data-href="/clients/client-1"');
    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain("S corporation");
    expect(html).toContain("alex@northwind.example");
    expect(html).toContain("Seattle, WA");
    expect(html).toContain('href="/clients?new=1"');
    expect(html).toContain("New client");
  });

  test("client detail renders engagement rows linking to the workspace", () => {
    const html = renderClientDetail(detailData());

    expect(html).toContain("Northwind Partners LLC");
    expect(html).toContain('data-href="/engagements/eng-1"');
    expect(html).toContain("1120-S");
    expect(html).toContain("2025");
    expect(html).toContain("In review");
    expect(html).toContain('href="/engagements?new=1&client=client-1"');
    expect(html).toContain("New engagement");
  });

  test("clients list module exports load and render", () => {
    expect(typeof clientsPage.load).toBe("function");
    expect(typeof clientsPage.render).toBe("function");
    expect(typeof clientsPage.bind).toBe("function");
  });
});
