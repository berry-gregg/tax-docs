import { describe, expect, test } from "bun:test";
import { pageForPath } from "../../src/client/app/router.ts";
import { greetingFor } from "../../src/client/app/greeting.ts";
import { renderApp } from "../../src/client/app/render.ts";
import { navItems } from "../../src/client/app/nav.ts";

describe("shell router", () => {
  test("maps product paths onto shell pages", () => {
    expect(pageForPath("/")).toBe("home");
    expect(pageForPath("/home")).toBe("home");
    expect(pageForPath("/documents")).toBe("documents");
    expect(pageForPath("/review")).toBe("review");
    expect(pageForPath("/clients")).toBe("clients");
    expect(pageForPath("/inbox")).toBe("inbox");
    expect(pageForPath("/settings")).toBe("settings");
    expect(pageForPath("/missing")).toBe("not-found");
  });
});

describe("home greeting", () => {
  test("uses time of day without a welcome-back line", () => {
    expect(greetingFor(new Date("2026-08-19T08:00:00"))).toBe("Good morning");
    expect(greetingFor(new Date("2026-08-19T14:00:00"))).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-08-19T20:00:00"))).toBe("Good evening");
  });
});

describe("app shell markup", () => {
  test("home paints the Ramp-like chrome, queue headline, and rail actions", () => {
    const html = renderApp({
      pathname: "/",
      now: new Date("2026-08-19T20:00:00"),
    });

    expect(html).toContain('data-app-shell="true"');
    expect(html).toContain("Good evening");
    expect(html).toContain("3 documents need review");
    expect(html).toContain("Request documents");
    expect(html).toContain("Recent documents");
    expect(html).not.toContain("Welcome back");

    for (const item of navItems) {
      expect(html).toContain(item.label);
    }
  });

  test("documents page uses a filter bar and dual-line table", () => {
    const html = renderApp({ pathname: "/documents" });

    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Needs review");
    expect(html).toContain("Add filter");
    expect(html).toContain("Client");
    expect(html).toContain("W-2");
  });

  test("review page is a queue table with status tabs", () => {
    const html = renderApp({ pathname: "/review" });

    expect(html).toContain("Ready to export");
    expect(html).toContain("Waiting for client");
    expect(html).toContain("Export selected");
  });

  test("clients page lists people with role and firm", () => {
    const html = renderApp({ pathname: "/clients" });

    expect(html).toContain("Invite client");
    expect(html).toContain("Northwind Partners");
  });

  test("settings shows company profile fields and API health slot", () => {
    const html = renderApp({ pathname: "/settings" });

    expect(html).toContain("Company profile");
    expect(html).toContain("data-api-status");
  });

  test("unknown paths get an inline not-found state", () => {
    const html = renderApp({ pathname: "/nope" });

    expect(html).toContain("Page not found");
  });

  test("home expands only the active nav group with a punch-out current child", () => {
    const html = renderApp({
      pathname: "/",
      now: new Date("2026-08-19T20:00:00"),
    });

    expect(html).toContain('data-nav-group="home"');
    expect(html).toContain('data-nav-group="home" class="nav-group is-active"');
    expect(html).toContain('data-nav-child="overview" class="nav-child is-current"');
    expect(html).toContain("Overview");

    const documentsChunk = html.slice(
      html.indexOf('data-nav-group="documents"'),
      html.indexOf('data-nav-group="review"'),
    );
    expect(documentsChunk).not.toContain("Needs review");
    expect(html).not.toContain('data-nav-group="documents" class="nav-group is-active"');
  });

  test("documents expands its nested children and leaves home collapsed", () => {
    const html = renderApp({ pathname: "/documents" });

    expect(html).toContain('data-nav-group="documents" class="nav-group is-active"');
    expect(html).toContain('data-nav-child="documents-all" class="nav-child is-current"');
    expect(html).not.toContain('data-nav-group="home" class="nav-group is-active"');
    expect(html).not.toContain("Overview");
  });

  test("command palette clones Ramp Command K markup", () => {
    const html = renderApp({ pathname: "/" });

    expect(html).toContain('data-command-palette');
    expect(html).toContain("Search Tax Docs");
    expect(html).toContain("Where do you want to go?");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Documents / Request documents");
    expect(html).toContain('class="palette-group-label"');
    expect(html).toContain("Actions");
    expect(html).toContain("Pages");
    expect(html).toContain('class="palette-search-icon"');
    expect(html).toContain('data-palette-active="true"');
  });

  test("nav icons are 12px Feather marks, including the settings gear", () => {
    const html = renderApp({ pathname: "/settings" });

    expect(html).toContain('data-icon="settings"');
    expect(html).toContain('width="12"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("M19.4 15");
    expect(html).toContain('stroke-width="2"');
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

describe("favicon", () => {
  test("index.html points at the design-system GB mark", async () => {
    const html = await Bun.file("index.html").text();
    const icon = Bun.file("design-system/gb-favicon.png");

    expect(await icon.exists()).toBe(true);
    expect(html).toContain('rel="icon"');
    expect(html).toContain("design-system/gb-favicon.png");
  });

  test("sidebar brand uses the GB favicon next to Tax Docs", () => {
    const html = renderApp({ pathname: "/" });

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
