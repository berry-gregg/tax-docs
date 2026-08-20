import feather from "feather-icons";

/** Feather Icons — the set Ramp wraps as RyuIconSvg. Nav marks render at 12px. */
export type FeatherName = keyof typeof feather.icons;

function mark(name: FeatherName, size: 12 | 16 = 12): string {
  const icon = feather.icons[name];
  if (!icon) {
    throw new Error(`Unknown Feather icon: ${String(name)}`);
  }

  return icon.toSvg({
    width: size,
    height: size,
    class: "icon",
    "aria-hidden": "true",
    "data-icon": name,
  });
}

export const icons = {
  inbox: mark("inbox"),
  home: mark("home"),
  documents: mark("file-text"),
  review: mark("book-open"),
  clients: mark("users"),
  settings: mark("settings"),
  search: mark("search"),
  searchLg: mark("search", 16),
  collapse: mark("sidebar"),
  plus: mark("plus", 16),
  download: mark("download", 16),
  dots: mark("more-vertical", 16),
  filter: mark("filter", 16),
  chevron: mark("chevron-down", 16),
  check: mark("check", 16),
  warning: mark("alert-triangle", 16),
  arrow: mark("arrow-right", 16),
} as const;

/** Command K rows use the same Feather marks at 16px, matching Ramp's RyuIconSvg--asSizeM. */
export const paletteIcons = {
  inbox: mark("inbox", 16),
  home: mark("home", 16),
  documents: mark("file-text", 16),
  review: mark("book-open", 16),
  clients: mark("users", 16),
  settings: mark("settings", 16),
  plus: mark("plus", 16),
} as const;
