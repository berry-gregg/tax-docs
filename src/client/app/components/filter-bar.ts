import { escapeHtml } from "../render.ts";

/**
 * The one filter-bar recipe for list pages (Documents, Engagements): labeled native selects
 * bound to real data, synced to the URL query string so views are shareable. Pages own the
 * option lists and the URL grammar; this module owns the markup and the change→pushState wiring.
 */

export type FilterOption = { value: string; label: string };

export function filterSelect(opts: {
  name: string;
  label: string;
  options: FilterOption[];
  selected: string;
}): string {
  return `<label class="filter-field">
    <span class="filter-label">${escapeHtml(opts.label)}</span>
    <select data-filter="${escapeHtml(opts.name)}">
      ${opts.options
        .map(
          (option) =>
            `<option value="${escapeHtml(option.value)}"${option.value === opts.selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
        )
        .join("")}
    </select>
  </label>`;
}

/** `clearHref` renders the quiet "Clear filters" link; pass null while no filter is active. */
export function filterBar(selects: string[], clearHref: string | null): string {
  return `<div class="filter-bar" data-filter-bar>
    ${selects.join("")}
    ${clearHref ? `<a class="text-link filter-clear" href="${escapeHtml(clearHref)}" data-nav-link>Clear filters</a>` : ""}
  </div>`;
}

/**
 * Every select change pushes the page URL the owning page derives from the new value, then
 * repaints — the page's `load()` refetches from the server with the new query string.
 */
export function bindFilterBar(
  root: HTMLElement,
  hrefFor: (name: string, value: string) => string,
  repaint: () => void,
): void {
  root.querySelectorAll<HTMLSelectElement>("[data-filter]").forEach((select) => {
    select.addEventListener("change", () => {
      const name = select.getAttribute("data-filter");
      if (!name) {
        return;
      }

      globalThis.history.pushState({}, "", hrefFor(name, select.value));
      repaint();
    });
  });
}
