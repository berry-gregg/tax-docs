import { describe, expect, test } from "bun:test";
import { greetingFor } from "../../src/client/app/greeting.ts";
import { navItems } from "../../src/client/app/nav.ts";
import {
  bindPortalLinkControls,
  bindRowLinks,
  breadcrumbs,
  confidenceChip,
  pageHeader,
  pipelineChip,
  portalLinkControl,
  renderApp,
  renderLoadError,
  renderPageSkeleton,
  stageChip,
} from "../../src/client/app/render.ts";

describe("home greeting", () => {
  test("uses time of day without a welcome-back line", () => {
    expect(greetingFor(new Date("2026-08-19T08:00:00"))).toBe("Good morning");
    expect(greetingFor(new Date("2026-08-19T14:00:00"))).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-08-19T20:00:00"))).toBe("Good evening");
  });
});

describe("nav tree", () => {
  test("is Inbox, Home, Documents, Engagements, Clients, and a Settings footer", () => {
    expect(navItems.filter((item) => item.section === "main").map((item) => item.label)).toEqual([
      "Inbox",
      "Home",
      "Documents",
      "Engagements",
      "Clients",
    ]);
    expect(navItems.filter((item) => item.section === "footer").map((item) => item.label)).toEqual([
      "Settings",
    ]);
    expect(navItems.map((item) => item.label)).not.toContain("Review");
  });

  test("documents nests All and the needs-review lens", () => {
    const documents = navItems.find((item) => item.id === "documents");

    expect(documents?.href).toBe("/documents?tab=needs-review");
    expect(documents?.children).toEqual([
      { id: "documents-all", label: "All", href: "/documents?tab=all" },
      { id: "documents-needs-review", label: "Needs review", href: "/documents?tab=needs-review" },
    ]);
  });

  test("only Inbox and Documents carry a live badge", () => {
    expect(navItems.find((item) => item.id === "inbox")?.badge).toBe("inbox-unread");
    expect(navItems.find((item) => item.id === "documents")?.badge).toBe("documents-needs-review");
    for (const item of navItems) {
      if (item.id !== "inbox" && item.id !== "documents") {
        expect(item.badge).toBeUndefined();
      }
    }
  });
});

describe("app shell chrome", () => {
  test("wraps the page body the registry produced", () => {
    const html = renderApp({ pathname: "/", body: '<h1 class="page-title">Live body</h1>' });

    expect(html).toContain('data-app-shell="true"');
    expect(html).toContain('<h1 class="page-title">Live body</h1>');
    expect(html).toContain('class="workspace"');

    for (const item of navItems) {
      expect(html).toContain(item.label);
    }
  });

  test("the inbox badge is the live unread count, hidden at zero", () => {
    const withUnread = renderApp({ pathname: "/", body: "", inboxUnreadCount: 5 });
    const withoutUnread = renderApp({ pathname: "/", body: "", inboxUnreadCount: 0 });

    expect(withUnread).toContain('<span class="badge" data-inbox-badge>5</span>');
    expect(withoutUnread).toContain('data-inbox-badge hidden');
    expect(withoutUnread).not.toContain(">3</span>");
  });

  test("the documents badge is the live needs-review count, hidden at zero", () => {
    const withQueue = renderApp({ pathname: "/", body: "", documentsNeedsReviewCount: 4 });
    const withoutQueue = renderApp({ pathname: "/", body: "", documentsNeedsReviewCount: 0 });

    expect(withQueue).toContain('<span class="badge" data-documents-badge>4</span>');
    expect(withoutQueue).toContain("data-documents-badge hidden");
  });

  test("engagement and export deep links keep the Engagements group current", () => {
    const html = renderApp({ pathname: "/engagements/eng-1/export", body: "" });

    expect(html).toContain('data-nav-group="engagements" class="nav-group is-active"');
    expect(html).toContain('data-icon="briefcase"');
  });

  test("a document review deep link keeps the Documents group current", () => {
    const html = renderApp({ pathname: "/documents/doc-1", body: "" });

    expect(html).toContain('data-nav-group="documents" class="nav-group is-active"');
  });

  test("documents expands its children and marks the lens matching the query string", () => {
    const all = renderApp({
      pathname: "/documents",
      search: "?tab=all",
      body: "",
    });
    const needsReview = renderApp({
      pathname: "/documents",
      search: "?tab=needs-review",
      body: "",
    });

    expect(all).toContain('data-nav-group="documents" class="nav-group is-active"');
    expect(all).toContain('data-nav-child="documents-all" class="nav-child is-current"');
    expect(needsReview).toContain(
      'data-nav-child="documents-needs-review" class="nav-child is-current"',
    );
    expect(needsReview).not.toContain('data-nav-child="documents-all" class="nav-child is-current"');
  });

  test("bare /documents does not punch out All", () => {
    const html = renderApp({ pathname: "/documents", body: "" });

    expect(html).toContain('data-nav-group="documents" class="nav-group is-active"');
    expect(html).not.toContain('data-nav-child="documents-all" class="nav-child is-current"');
  });

  test("an unmatched documents ?tab= lens does not punch out All", () => {
    const html = renderApp({
      pathname: "/documents",
      search: "?tab=trusted",
      body: "",
    });

    expect(html).toContain('data-nav-group="documents" class="nav-group is-active"');
    expect(html).not.toContain('data-nav-child="documents-all" class="nav-child is-current"');
    expect(html).not.toContain('class="nav-child is-current"');
  });

  test("a non-current group renders no children", () => {
    const html = renderApp({ pathname: "/inbox", body: "" });

    expect(html).toContain('data-nav-group="inbox" class="nav-group is-active"');
    expect(html).not.toContain('data-nav-child="documents-all"');
  });

  test("the portal route paints without the sidebar or the command palette", () => {
    const html = renderApp({ pathname: "/portal/tok", body: "<p>Upload here</p>" });

    expect(html).toContain("Upload here");
    expect(html).toContain('data-app-shell="portal"');
    expect(html).not.toContain('class="sidebar"');
    expect(html).not.toContain("data-command-palette");
    expect(html).not.toContain("data-nav-link");
  });

  test("command palette markup still clones Ramp Command K", () => {
    const html = renderApp({ pathname: "/", body: "" });

    expect(html).toContain("data-command-palette");
    expect(html).toContain("Search Tax Docs");
    expect(html).toContain("Where do you want to go?");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('class="palette-group-label"');
    expect(html).toContain("Actions");
    expect(html).toContain("Pages");
    expect(html).toContain('data-palette-active="true"');
  });

  test("nav icons are 12px Feather marks, including the settings gear", () => {
    const html = renderApp({ pathname: "/settings", body: "" });

    expect(html).toContain('data-icon="settings"');
    expect(html).toContain('width="12"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("M19.4 15");
    expect(html).toContain('stroke-width="2"');
  });

  test("collapsed nav links keep an accessible name and tooltip from the item label", () => {
    const home = renderApp({ pathname: "/", body: "" });
    const documents = renderApp({ pathname: "/documents", body: "" });

    for (const item of navItems) {
      expect(home).toContain(`aria-label="${item.label}"`);
      expect(home).toContain(`title="${item.label}"`);
    }

    expect(home).toMatch(
      /<button class="nav-search"[^>]*aria-label="Search"[^>]*title="Search"/,
    );
    expect(documents).toMatch(
      /<a data-nav-child="documents-all"[^>]*aria-label="All"[^>]*title="All"/,
    );
    expect(documents).toMatch(
      /<a data-nav-child="documents-needs-review"[^>]*aria-label="Needs review"[^>]*title="Needs review"/,
    );
  });

  test("pageHeader leaves /api/ action hrefs as normal downloads", () => {
    const html = pageHeader("Export", undefined, [
      { href: "/engagements/eng-1", label: "Back", kind: "secondary" },
      { href: "/api/exports/exp-1/payload", label: "Download payload", kind: "secondary" },
    ]);

    const back = html.match(/<a[^>]*href="\/engagements\/eng-1"[^>]*>/)?.[0];
    const download = html.match(/<a[^>]*href="\/api\/exports\/exp-1\/payload"[^>]*>/)?.[0];

    expect(back).toContain("data-nav-link");
    expect(download).toBeDefined();
    expect(download).not.toContain("data-nav-link");
  });

  test("pageHeader does not emit an unbound More actions kebab", () => {
    const html = pageHeader("Documents", "4", [
      { href: "/documents", label: "Upload", kind: "primary" },
    ]);

    expect(html).not.toContain('aria-label="More actions"');
  });

  test("list chrome does not emit a toolbar or unbound filter controls", () => {
    const html = pageHeader("Documents", "4", [
      { href: "/documents", label: "Upload", kind: "primary" },
    ]);

    expect(html).not.toContain("Add filter");
    expect(html).not.toContain('aria-label="Export"');
    expect(html).not.toContain('class="toolbar"');
  });
});

describe("status chip SSOT", () => {
  test("stageChip is the one engagement-stage vocabulary, sentence cased", () => {
    expect(stageChip("draft")).toBe('<span class="chip chip-processing">Draft</span>');
    expect(stageChip("collecting")).toBe('<span class="chip chip-processing">Collecting</span>');
    expect(stageChip("in-review")).toBe('<span class="chip chip-warning">In review</span>');
    expect(stageChip("ready-to-export")).toBe(
      '<span class="chip chip-success">Ready to export</span>',
    );
    expect(stageChip("exported")).toBe('<span class="chip chip-success">Exported</span>');
  });

  test("confidence renders as the chip recipe with a tier modifier, not a fork", () => {
    expect(confidenceChip(0.96)).toBe('<span class="chip confidence-high">96%</span>');
    expect(confidenceChip(0.72)).toBe('<span class="chip confidence-medium">72%</span>');
    expect(confidenceChip(0.2)).toBe('<span class="chip confidence-low">20%</span>');
  });

  test("needs-review keeps the same warning chip everywhere", () => {
    expect(pipelineChip("needs-review")).toBe('<span class="chip chip-warning">Needs review</span>');
  });
});

describe("bindRowLinks", () => {
  test("activates data-href rows on click and Enter without stacking on interactive children", () => {
    const pushed: string[] = [];
    const previousHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
    Object.defineProperty(globalThis, "history", {
      configurable: true,
      value: {
        pushState(_data: unknown, _unused: string, url?: string | URL | null) {
          if (typeof url === "string") {
            pushed.push(url);
          }
        },
      },
    });

    try {
      const root = makeFakeRowRoot();
      let paints = 0;
      bindRowLinks(root as unknown as HTMLElement, () => {
        paints += 1;
      });

      root.row.dispatch("click", root.row);
      root.row.dispatch("keydown", root.row, "Enter");
      root.row.dispatch("click", root.button);

      expect(pushed).toEqual(["/engagements/eng-1", "/engagements/eng-1"]);
      expect(paints).toBe(2);
    } finally {
      if (previousHistory) {
        Object.defineProperty(globalThis, "history", previousHistory);
      } else {
        Reflect.deleteProperty(globalThis, "history");
      }
    }
  });
});

describe("portalLinkControl", () => {
  test("is one compact ghost copy button plus an open link — no readonly field", () => {
    const html = portalLinkControl("/portal/tok-1");

    expect(html).toContain("data-portal-link-control");
    expect(html).toMatch(
      /<button type="button" class="btn-ghost portal-link-copy" data-copy-portal-link="\/portal\/tok-1">Copy portal link<\/button>/,
    );
    expect(html).toMatch(/<a class="portal-link-open" href="\/portal\/tok-1" data-nav-link>Open<\/a>/);
    expect(html).not.toContain("readonly");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("btn-secondary");
  });

  test("escapes the url and honors a custom label", () => {
    const html = portalLinkControl('/portal/"tok', "Copy link");

    expect(html).toContain("&quot;tok");
    expect(html).not.toContain('href="/portal/"tok"');
    expect(html).toContain(">Copy link</button>");
  });

  test("copying writes the absolute portal url and flips to a brief Copied state", () => {
    const written: string[] = [];
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText(text: string) {
            written.push(text);
            return Promise.resolve();
          },
        },
      },
    });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { origin: "https://firm.example" },
    });

    try {
      const button = new FakeCopyButton("/portal/tok-1");
      const root = {
        querySelectorAll(selector: string) {
          return selector === "[data-copy-portal-link]" ? [button] : [];
        },
      };

      bindPortalLinkControls(root as unknown as HTMLElement);
      button.click();

      expect(written).toEqual(["https://firm.example/portal/tok-1"]);
      expect(button.textContent).toBe("Copied");
    } finally {
      if (previousNavigator) {
        Object.defineProperty(globalThis, "navigator", previousNavigator);
      } else {
        Reflect.deleteProperty(globalThis, "navigator");
      }
      if (previousLocation) {
        Object.defineProperty(globalThis, "location", previousLocation);
      } else {
        Reflect.deleteProperty(globalThis, "location");
      }
    }
  });
});

describe("load states", () => {
  test("the loading state is a skeleton, not the word loading", () => {
    const html = renderPageSkeleton();

    expect(html).toContain("data-page-loading");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("skeleton-bar");
    expect(html.toLowerCase()).not.toContain("loading...");
  });

  test("a failed load shows the real server message and a retry control", () => {
    const html = renderLoadError("Document is not awaiting review");

    expect(html).toContain("Document is not awaiting review");
    expect(html).toContain("data-retry");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Something went wrong");
  });

  test("the error message is escaped rather than injected", () => {
    expect(renderLoadError('<img src="x">')).not.toContain('<img src="x">');
  });
});

describe("product tokens", () => {
  test("tokens.css matches the live Ramp app ink, chrome, and radii", async () => {
    const css = await Bun.file("design-system/css/tokens.css").text();

    expect(css).toContain("--color-ink: #2e2e27");
    expect(css).toContain("--color-ash: #707062");
    expect(css).toContain("--color-hairline: #ebe8e5");
    expect(css).toContain("--color-success: #26763b");
    expect(css).toContain("--surface-sidebar: #f4f3ef");
    expect(css).toContain("--surface-inverted: #1a1919");
    expect(css).toContain("--icon-size-nav: 12px");
    expect(css).toContain("--icon-size-nav-collapsed: 16px");
    expect(css).toContain("--icon-size-brand: 20px");
    expect(css).toContain("--icon-size-brand-collapsed: 28px");
    expect(css).toContain("--radius-buttons: 0px");
    expect(css).toContain("--radius-nav: 4px");
    expect(css).toContain("--color-input-hairline: #dbdac9");
    expect(css).toContain("--shadow-palette:");
  });
});

describe("global fixed sidebar", () => {
  test("the sidebar is sticky, full-viewport, and independently scrollable", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(/\.sidebar \{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/\.sidebar \{[^}]*top:\s*0/s);
    expect(css).toMatch(/\.sidebar \{[^}]*align-self:\s*start/s);
    expect(css).toMatch(/\.sidebar \{[^}]*height:\s*100vh/s);
    expect(css).toMatch(/\.sidebar \{[^}]*max-height:\s*100vh/s);
    expect(css).toMatch(/\.sidebar \{[^}]*overflow-y:\s*auto/s);
  });

  test("the stacked mobile layout reverts the sidebar to static flow", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();
    const media = css.slice(css.indexOf("@media (max-width: 960px)"));

    expect(media).toMatch(/\.sidebar \{[^}]*position:\s*static/s);
    expect(media).toMatch(/\.sidebar \{[^}]*height:\s*auto/s);
    expect(media).toMatch(/\.sidebar \{[^}]*overflow-y:\s*visible/s);
  });
});

describe("breadcrumbs helper", () => {
  test("renders ash links, / separators, and the current page as ink text", () => {
    const html = breadcrumbs([
      { label: "Engagements", href: "/engagements" },
      { label: "Northwind Partners LLC" },
    ]);

    expect(html).toContain('<nav class="breadcrumbs" aria-label="Breadcrumb">');
    expect(html).toMatch(
      /<a class="breadcrumb-link" href="\/engagements" data-nav-link>Engagements<\/a>/,
    );
    expect(html).toContain('aria-hidden="true"> / </span>');
    expect(html).toMatch(
      /<span class="breadcrumb-current" aria-current="page">Northwind Partners LLC<\/span>/,
    );
  });

  test("the last item never renders as a link even when it has an href", () => {
    const html = breadcrumbs([
      { label: "Engagements", href: "/engagements" },
      { label: "Acme", href: "/engagements/eng-1" },
    ]);

    expect(html).not.toContain('href="/engagements/eng-1"');
    expect(html).toContain('class="breadcrumb-current"');
  });

  test("escapes labels and hrefs", () => {
    const html = breadcrumbs([{ label: '<img src="x">' }]);

    expect(html).not.toContain('<img src="x">');
  });
});

describe("workspace status and form furniture", () => {
  test("the engagement status strip is one hairline-ruled line, not a ticker", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(/\.engagement-status \{[^}]*border-top:\s*1px solid var\(--color-hairline\)/s);
    expect(css).toMatch(/\.engagement-status \{[^}]*border-bottom:\s*1px solid var\(--color-hairline\)/s);
    expect(css).toMatch(/\.engagement-status \{[^}]*color:\s*var\(--color-ash\)/s);
    expect(css).toMatch(/\.engagement-status-value \{[^}]*color:\s*var\(--color-ink\)/s);
  });

  test("validation rows use a two-column template so chips keep natural width", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(
      /\.validation-list \.list-row \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s,
    );
    expect(css).toMatch(/\.list-row > \.chip \{[^}]*justify-self:\s*end/s);
  });

  test("hidden-but-focusable inputs use the clip recipe, never display none", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(/\.visually-hidden-input \{[^}]*clip-path:\s*inset\(50%\)/s);
    expect(css).not.toMatch(/\.visually-hidden-input \{[^}]*display:\s*none/s);
  });

  test("segmented selector marks the checked option with ink border and wash fill", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(
      /\.segmented-option\.is-selected,\s*\.segmented-option:has\(input:checked\) \{[^}]*border-color:\s*var\(--color-ink\)/s,
    );
    expect(css).toMatch(
      /\.segmented-option\.is-selected,\s*\.segmented-option:has\(input:checked\) \{[^}]*background:\s*var\(--surface-wash\)/s,
    );
  });

  test("breadcrumbs are ash with an ink current page", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(/\.breadcrumbs \{[^}]*color:\s*var\(--color-ash\)/s);
    expect(css).toMatch(/\.breadcrumb-current \{[^}]*color:\s*var\(--color-ink\)/s);
  });
});

describe("shell.css page furniture", () => {
  test("adds the pipeline chips, modal, side panel, dropzone, and confidence badges", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).not.toContain(".ticker");
    expect(css).toMatch(/\.chip-processing \{[^}]*color:\s*var\(--color-ash\)/s);
    expect(css).toMatch(/\.chip-warning \{[^}]*color:\s*var\(--color-warning\)/s);
    expect(css).toMatch(/\.chip-success \{[^}]*color:\s*var\(--color-success\)/s);
    expect(css).toMatch(/\.chip-halted \{[^}]*color:\s*var\(--color-warning\)/s);
    expect(css).toContain(".modal-panel");
    expect(css).toContain(".side-panel");
    expect(css).toContain(".dropzone");
    expect(css).toContain(".confidence-high");
    expect(css).toContain(".skeleton-bar");
    expect(css).toContain(".load-error");
  });

  test("the wide modal modifier only widens the panel — one panel recipe", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(
      /\.modal-panel-wide \{[^}]*width:\s*min\(840px, calc\(100vw - var\(--spacing-48\)\)\)/s,
    );
  });

  test("one drawn 16px checkbox recipe replaces native checkboxes everywhere", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(/\.checkbox-box \{[^}]*width:\s*16px/s);
    expect(css).toMatch(/\.checkbox-box \{[^}]*border:\s*1px solid var\(--color-input-hairline\)/s);
    expect(css).toMatch(/\.checkbox:has\(input:checked\) \.checkbox-box \{[^}]*background:\s*var\(--color-ink\)/s);
    // The recipe is the single source of truth — the old ad-hoc class is gone.
    expect(css).not.toContain(".check-field");
  });

  test("confidence tiers are modifiers of the one .chip recipe, not a duplicate block", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css.match(/^\.chip \{/gm)?.length).toBe(1);
    expect(css).not.toMatch(/^\.confidence \{/m);
  });

  test("dead status, toolbar, and search-field recipes are gone", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).not.toContain(".toolbar");
    expect(css).not.toContain(".search-field");
    expect(css).not.toMatch(/^\.status \{/m);
    expect(css).not.toContain(".status-");
  });

  test("form-field is defined once, with the settings-era padding and textarea support", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css.match(/^\.form-field \{/gm)?.length).toBe(1);
    expect(css).toMatch(
      /\.form-field input,\s*\.form-field select,\s*\.form-field textarea \{[^}]*padding:\s*var\(--spacing-8\) var\(--spacing-12\)/s,
    );
  });

  test("list rows and table rows share the bone hover wash", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(/\.list-row:hover \{[^}]*background:\s*var\(--surface-wash\)/s);
    expect(css).toMatch(
      /\.data-table tr\[data-href\]:hover \{[^}]*background:\s*var\(--surface-wash\)/s,
    );
  });

  test("no raw hex values leak into the shell stylesheet", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("token and base hygiene", () => {
  test("unreferenced banner and tags tokens are removed", async () => {
    const tokens = await Bun.file("design-system/css/tokens.css").text();

    expect(tokens).not.toContain("--color-banner");
    expect(tokens).not.toContain("--surface-banner");
    expect(tokens).not.toContain("--radius-tags");
  });

  test("a zero-count badge fully disappears — hidden must beat the badge display", async () => {
    const css = await Bun.file("design-system/css/base.css").text();

    expect(css).toMatch(/\.badge\[hidden\] \{[^}]*display:\s*none/s);
  });

  test("marketing-era .page and .card primitives are gone from base.css", async () => {
    const css = await Bun.file("design-system/css/base.css").text();

    expect(css).not.toMatch(/^\.page \{/m);
    expect(css).not.toMatch(/^\.card \{/m);
  });
});

type RowListener = (event: {
  target: FakeRowElement;
  key?: string;
  preventDefault(): void;
}) => void;

class FakeRowElement {
  parent: FakeRowElement | null = null;
  private readonly listeners = new Map<string, RowListener[]>();

  constructor(
    readonly selector: string,
    readonly attributes: Record<string, string> = {},
  ) {}

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  addEventListener(type: string, listener: RowListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  closest(selector: string): FakeRowElement | null {
    if (selector === "a,button,input,label" && this.selector === "button") {
      return this;
    }
    return this.parent?.closest(selector) ?? null;
  }

  click(): void {
    this.dispatch("click", this);
  }

  dispatch(type: string, target: FakeRowElement, key?: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target, key, preventDefault() {} });
    }
  }
}

type CopyClickListener = (event: { preventDefault(): void; stopPropagation(): void }) => void;

class FakeCopyButton {
  textContent: string | null = "Copy portal link";
  private readonly listeners: CopyClickListener[] = [];

  constructor(private readonly href: string) {}

  getAttribute(name: string): string | null {
    return name === "data-copy-portal-link" ? this.href : null;
  }

  addEventListener(_type: string, listener: CopyClickListener): void {
    this.listeners.push(listener);
  }

  click(): void {
    for (const listener of this.listeners) {
      listener({ preventDefault() {}, stopPropagation() {} });
    }
  }
}

function makeFakeRowRoot() {
  const row = new FakeRowElement("tr", { "data-href": "/engagements/eng-1" });
  const button = new FakeRowElement("button");
  button.parent = row;

  return {
    row,
    button,
    querySelectorAll(selector: string) {
      return selector === "[data-href]" ? [row] : [];
    },
  };
}

describe("favicon", () => {
  test("index.html points at the design-system GB mark", async () => {
    const html = await Bun.file("index.html").text();
    const icon = Bun.file("design-system/gb-favicon.png");

    expect(await icon.exists()).toBe(true);
    expect(html).toContain('rel="icon"');
    expect(html).toContain("design-system/gb-favicon.png");
  });

  test("sidebar brand uses the GB favicon next to Tax Docs", () => {
    const html = renderApp({ pathname: "/", body: "" });

    expect(html).toContain("<img");
    expect(html).toContain('class="brand-mark"');
    expect(html).toContain("gb-favicon.png");
    expect(html).toContain("Tax Docs");
    expect(html).toContain("data-collapse-nav");
  });
});

describe("collapsed sidebar", () => {
  test("collapsed nav icons scale to Ramp's 16px size", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toContain("--icon-size-nav-collapsed");
    expect(css).toContain(".app.is-collapsed .nav-icon .icon");
    expect(css).toContain("var(--icon-size-nav-collapsed)");
  });

  test("collapsed brand mark grows and hides the expand control until hover", async () => {
    const tokens = await Bun.file("design-system/css/tokens.css").text();
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(tokens).toContain("--icon-size-brand: 20px");
    expect(tokens).toContain("--icon-size-brand-collapsed: 28px");
    expect(css).toContain("var(--icon-size-brand-collapsed)");
    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head \[data-collapse-nav\] \{[^}]*position:\s*absolute/s,
    );
    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head \[data-collapse-nav\] \{[^}]*opacity:\s*0/s,
    );
    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head:hover \[data-collapse-nav\] \{[^}]*opacity:\s*1/s,
    );
    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head:focus-within \[data-collapse-nav\] \{[^}]*opacity:\s*1/s,
    );
    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head:hover \.brand-mark \{[^}]*opacity:\s*0/s,
    );
    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head:focus-within \.brand-mark \{[^}]*opacity:\s*0/s,
    );
  });

  test("collapsed brand mark is centered in the rail", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head \{[^}]*justify-content:\s*center/s,
    );
    expect(css).toMatch(
      /\.app\.is-collapsed \.sidebar-head \{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(css).toMatch(/\.app\.is-collapsed \.brand \{[^}]*justify-self:\s*center/s);
    expect(css).not.toMatch(/\.app\.is-collapsed \.brand \{[^}]*width:\s*100%/s);
  });
});
