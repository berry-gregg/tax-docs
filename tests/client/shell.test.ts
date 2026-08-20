import { describe, expect, test } from "bun:test";
import { greetingFor } from "../../src/client/app/greeting.ts";
import { navItems } from "../../src/client/app/nav.ts";
import {
  bindRowLinks,
  pageHeader,
  renderApp,
  renderLoadError,
  renderPageSkeleton,
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

  test("engagement, review, and export deep links keep the Engagements group current", () => {
    const html = renderApp({ pathname: "/engagements/eng-1/review/doc-1", body: "" });

    expect(html).toContain('data-nav-group="engagements" class="nav-group is-active"');
    expect(html).toContain('data-icon="briefcase"');
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

describe("shell.css page furniture", () => {
  test("adds the ticker strip, pipeline chips, modal, side panel, dropzone, and confidence badges", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).not.toMatch(/\.ticker \{[^}]*background:\s*var\(--surface-inverted\)/s);
    expect(css).toMatch(/\.ticker \{[^}]*border-top:\s*1px solid var\(--color-hairline\)/s);
    expect(css).not.toMatch(/\.ticker-label \{[^}]*text-transform:\s*uppercase/s);
    expect(css).toMatch(/\.ticker-label \{[^}]*color:\s*var\(--color-ash\)/s);
    expect(css).toMatch(/\.ticker-label \{[^}]*font-weight:\s*var\(--font-weight-regular\)/s);
    expect(css).toMatch(/\.ticker-value \{[^}]*color:\s*var\(--color-ink\)/s);
    expect(css).toMatch(/\.ticker-value \{[^}]*font-size:\s*var\(--text-ui\)/s);
    expect(css).toMatch(/\.ticker-value \{[^}]*font-weight:\s*var\(--font-weight-regular\)/s);
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

  test("no raw hex values leak into the shell stylesheet", async () => {
    const css = await Bun.file("src/client/styles/shell.css").text();

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
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
