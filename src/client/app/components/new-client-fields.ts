import { z } from "zod";
import {
  createClientInputSchema,
  entityTypeSchema,
} from "../../../shared/schemas/client.ts";
import { escapeHtml } from "../render.ts";

export const entityTypeLabels: Record<z.infer<typeof entityTypeSchema>, string> = {
  "s-corp": "S corporation",
  partnership: "Partnership",
  "c-corp": "C corporation",
  llc: "LLC",
};

export type NewClientFieldDraft = Partial<z.infer<typeof createClientInputSchema>>;

export function newClientFields(draft: NewClientFieldDraft = {}): string {
  return `<label class="form-field">
          <span class="form-label">Legal name</span>
          <input type="text" name="legalName" required autocomplete="organization" value="${escapeHtml(draft.legalName ?? "")}" />
        </label>
        <label class="form-field">
          <span class="form-label">Entity type</span>
          <select name="entityType" required>
            ${entityTypeSchema.options
              .map(
                (value) =>
                  `<option value="${value}" ${
                    draft.entityType === value ? "selected" : ""
                  }>${escapeHtml(entityTypeLabels[value])}</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">EIN</span>
          <input type="text" name="ein" required placeholder="XX-XXXXXXX" autocomplete="off" value="${escapeHtml(draft.ein ?? "")}" />
          <span class="form-hint">Format: XX-XXXXXXX</span>
        </label>
        <label class="form-field">
          <span class="form-label">Contact name</span>
          <input type="text" name="contactName" required autocomplete="name" value="${escapeHtml(draft.contactName ?? "")}" />
        </label>
        <label class="form-field">
          <span class="form-label">Contact email</span>
          <input type="email" name="contactEmail" required autocomplete="email" value="${escapeHtml(draft.contactEmail ?? "")}" />
        </label>
        <label class="form-field">
          <span class="form-label">City</span>
          <input type="text" name="city" required autocomplete="address-level2" value="${escapeHtml(draft.city ?? "")}" />
        </label>
        <label class="form-field">
          <span class="form-label">State</span>
          <input type="text" name="state" required autocomplete="address-level1" value="${escapeHtml(draft.state ?? "")}" />
        </label>`;
}
