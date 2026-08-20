import { describe, expect, test } from "bun:test";
import { clientSchema } from "../../src/shared/schemas/client.ts";
import { engagementSchema } from "../../src/shared/schemas/engagement.ts";
import { extractionFieldSchema, pipelineStatusSchema, taxDocumentSchema } from "../../src/shared/schemas/document.ts";
import { activitySchema } from "../../src/shared/schemas/activity.ts";
import { exportSchema } from "../../src/shared/schemas/export.ts";
import { validationCheckSchema } from "../../src/shared/schemas/validation.ts";

const iso = new Date().toISOString();

describe("engagement-side schemas", () => {
  test("engagement uses filingType, not returnType", () => {
    const e = engagementSchema.parse({
      id: "e1", clientId: "c1", taxYear: 2025, filingType: "1065",
      status: "collecting", portalToken: "tok-abc", createdAt: iso, updatedAt: iso,
    });
    expect(e.filingType).toBe("1065");
    expect(engagementSchema.safeParse({ ...e, filingType: "1040" }).success).toBe(false);
  });

  test("pipeline status enum matches the spec state machine", () => {
    expect(pipelineStatusSchema.options).toEqual([
      "received", "quality-review", "rejected", "classifying",
      "unclassified", "extracting", "needs-review", "trusted", "failed",
    ]);
  });

  test("extraction fields allow null value with notFound, and nullable regexPass", () => {
    const f = extractionFieldSchema.parse({
      key: "employer_ein", label: "Employer EIN", metadataType: "ein-tin",
      dataType: "string", value: null, confidence: 0.2, sourceSnippet: "",
      notFound: true, regexPass: null, reviewStatus: "unreviewed",
    });
    expect(f.value).toBeNull();
  });

  test("document with rejection carries kind and reason", () => {
    const d = taxDocumentSchema.parse({
      id: "d1", engagementId: "e1", filename: "lease.pdf", mimeType: "application/pdf",
      size: 1000, storagePath: "data/uploads/d1.pdf", uploadedBy: "client",
      pipelineStatus: "rejected",
      rejection: { kind: "irrelevant", reason: "Residential lease, not tax-relevant" },
      createdAt: iso, updatedAt: iso,
    });
    expect(d.rejection?.kind).toBe("irrelevant");
  });

  test("activity carries direction and optional readAt", () => {
    const a = activitySchema.parse({
      id: "a1", engagementId: "e1", actor: "client", action: "document-uploaded",
      detail: "941-q1.pdf", direction: "inbound", createdAt: iso,
    });
    expect(a.readAt).toBeUndefined();
  });

  test("validation checks are warn-only (no fail status)", () => {
    expect(validationCheckSchema.shape.status.options).toEqual(["pass", "warn"]);
  });

  test("export lines carry source refs back to document fields", () => {
    const ex = exportSchema.parse({
      id: "x1", engagementId: "e1", status: "draft",
      lines: [{ engineForm: "1120-S", lineId: "8", lineLabel: "Salaries and wages",
                value: 512000, sourceRefs: [{ documentId: "d2", fieldKey: "salaries_wages" }] }],
      createdAt: iso,
      payloadJson: "{}",
    });
    expect(ex.lines[0]?.sourceRefs[0]?.fieldKey).toBe("salaries_wages");
  });

  test("client entity types are the business set", () => {
    expect(clientSchema.shape.entityType.options).toEqual(["s-corp", "partnership", "c-corp", "llc"]);
  });

  test("extraction fields reuse fieldDefSchema for key, label, metadataType, dataType", () => {
    expect(extractionFieldSchema.shape.key).toBeDefined();
    expect(() =>
      extractionFieldSchema.parse({
        key: "Bad Key!", label: "Employer EIN", metadataType: "ein-tin",
        dataType: "string", value: null, confidence: 0.2, sourceSnippet: "",
        notFound: true, regexPass: null, reviewStatus: "unreviewed",
      }),
    ).toThrow();
  });

  test("classification documentTypeId and relatedDocumentIds reject empty strings", () => {
    const base = {
      id: "d1", engagementId: "e1", filename: "w2.pdf", mimeType: "application/pdf",
      size: 1000, storagePath: "data/uploads/d1.pdf", uploadedBy: "client" as const,
      pipelineStatus: "classifying" as const, createdAt: iso, updatedAt: iso,
    };
    expect(taxDocumentSchema.safeParse({
      ...base,
      classification: { documentTypeId: "", confidence: 0.9, reasoning: "W-2" },
    }).success).toBe(false);
    expect(validationCheckSchema.safeParse({
      checkId: "c1", label: "Missing W-2", status: "warn",
      explanation: "No W-2 found", relatedDocumentIds: [""],
    }).success).toBe(false);
  });
});
