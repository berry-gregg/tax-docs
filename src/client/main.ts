import "./styles/main.css";
import { healthResponseSchema } from "@shared/schemas/health";
import { flattenPalette, searchPalette } from "./app/command-palette.ts";
import { renderApp, renderPaletteResults } from "./app/render.ts";

const root = document.querySelector("#app");
let navCollapsed = false;
let paletteQuery = "";
let paletteActiveIndex = 0;

function paint(): void {
  if (!root) {
    return;
  }

  root.innerHTML = renderApp({
    pathname: window.location.pathname,
    now: new Date(),
  });

  if (navCollapsed) {
    root.querySelector(".app")?.classList.add("is-collapsed");
  }

  bindShell();
  syncCollapseControl();
  void refreshHealth();
}

function bindShell(): void {
  root?.querySelectorAll<HTMLAnchorElement>("[data-nav-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("/")) {
        return;
      }

      event.preventDefault();
      window.history.pushState({}, "", href);
      setPalette(false);
      paint();
    });
  });

  root?.querySelector("[data-collapse-nav]")?.addEventListener("click", () => {
    navCollapsed = !navCollapsed;
    root?.querySelector(".app")?.classList.toggle("is-collapsed", navCollapsed);
    syncCollapseControl();
  });

  const searchButtons = root?.querySelectorAll("[data-open-search]");
  searchButtons?.forEach((button) => {
    button.addEventListener("click", () => setPalette(true));
  });

  const palette = root?.querySelector("[data-command-palette]");
  palette?.addEventListener("click", (event) => {
    if (event.target === palette) {
      setPalette(false);
    }
  });

  const input = root?.querySelector<HTMLInputElement>("[data-command-input]");
  input?.addEventListener("input", () => {
    paletteQuery = input.value;
    paletteActiveIndex = 0;
    refreshPaletteResults();
  });
}

function paletteIsOpen(): boolean {
  const palette = root?.querySelector<HTMLElement>("[data-command-palette]");
  return Boolean(palette && !palette.hidden);
}

function setPalette(open: boolean): void {
  const palette = root?.querySelector<HTMLElement>("[data-command-palette]");
  if (!palette) {
    return;
  }

  palette.hidden = !open;

  if (!open) {
    paletteQuery = "";
    paletteActiveIndex = 0;
    return;
  }

  paletteQuery = "";
  paletteActiveIndex = 0;
  refreshPaletteResults();
  const input = root?.querySelector<HTMLInputElement>("[data-command-input]");
  if (input) {
    input.value = "";
    input.focus();
  }
}

function refreshPaletteResults(): void {
  const current = root?.querySelector("[data-palette-results]");
  if (!current) {
    return;
  }

  const groups = searchPalette(paletteQuery);
  const items = flattenPalette(groups);
  if (items.length > 0) {
    paletteActiveIndex = Math.min(Math.max(paletteActiveIndex, 0), items.length - 1);
  } else {
    paletteActiveIndex = 0;
  }

  current.outerHTML = renderPaletteResults(groups, paletteActiveIndex);
  bindPaletteResults();
  syncActiveDescendant();
}

function syncCollapseControl(): void {
  const button = root?.querySelector<HTMLButtonElement>("[data-collapse-nav]");
  if (!button) {
    return;
  }

  button.setAttribute("aria-label", navCollapsed ? "Expand navigation" : "Collapse navigation");
  button.setAttribute("aria-expanded", navCollapsed ? "false" : "true");
}

function bindPaletteResults(): void {
  root?.querySelectorAll<HTMLAnchorElement>("[data-palette-results] [data-nav-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("/")) {
        return;
      }

      event.preventDefault();
      window.history.pushState({}, "", href);
      setPalette(false);
      paint();
    });
  });
}

function syncActiveDescendant(): void {
  const input = root?.querySelector<HTMLInputElement>("[data-command-input]");
  const active = root?.querySelector<HTMLElement>("[data-palette-active='true']");
  if (input) {
    input.setAttribute("aria-activedescendant", active?.id ?? "");
  }
}

function movePaletteSelection(delta: number): void {
  const items = flattenPalette(searchPalette(paletteQuery));
  if (items.length === 0) {
    return;
  }

  paletteActiveIndex = (paletteActiveIndex + delta + items.length) % items.length;
  refreshPaletteResults();
}

function activatePaletteSelection(): void {
  const active = root?.querySelector<HTMLAnchorElement>("[data-palette-active='true']");
  active?.click();
}

async function refreshHealth(): Promise<void> {
  const statusEl = root?.querySelector<HTMLElement>("[data-api-status]");
  const dbEl = root?.querySelector<HTMLElement>("[data-db-status]");
  if (!statusEl) {
    return;
  }

  statusEl.dataset.state = "loading";

  try {
    const response = await fetch("/api/health");
    const payload = healthResponseSchema.parse(await response.json());
    statusEl.textContent = payload.status;
    statusEl.dataset.state = "ready";
    if (dbEl) {
      dbEl.textContent = payload.database;
    }
  } catch {
    statusEl.textContent = "Unavailable";
    statusEl.dataset.state = "error";
  }
}

window.addEventListener("popstate", () => {
  paint();
});

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    setPalette(!paletteIsOpen());
    return;
  }

  if (!paletteIsOpen()) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    setPalette(false);
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    movePaletteSelection(1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    movePaletteSelection(-1);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    activatePaletteSelection();
  }
});

paint();
