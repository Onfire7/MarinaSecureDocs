import type { CurrentUser } from "../lib/auth/useCurrentUser";
import type { Catalog } from "../i18n/locales/en";

/** A section's key into layout:nav (its name) and layout:tab (its tab word). */
export type NavKey = keyof Catalog["layout"]["nav"];

export interface NavSection {
  path: string;
  key: NavKey;
  icon: string; // emoji glyph for the mobile tab bar
  /** Omit from nav unless this returns true. Absent = visible to everyone. */
  visible?: (current: CurrentUser) => boolean;
}

// Top-level sections, in sidenav order. This list is the authority for that
// order; the wireframe that once drew it is gone.
export const NAV_SECTIONS: NavSection[] = [
  { path: "/", key: "home", icon: "⌂" },
  { path: "/checklists", key: "checklists", icon: "☑" },
  { path: "/locations", key: "locations", icon: "⚓" },
  { path: "/audits", key: "audits", icon: "🔍" },
  { path: "/comms", key: "comms", icon: "☎" },
  { path: "/tickets", key: "tickets", icon: "🔧" },
  {
    path: "/incidents",
    key: "incidents",
    icon: "⚠",
    visible: (c) => c.can("view_incidents") || c.can("create_incidents"),
  },
  { path: "/reservations", key: "reservations", icon: "📅" },
  { path: "/boats", key: "boats", icon: "⛵" },
  { path: "/contacts", key: "contacts", icon: "👤" },
  { path: "/assets", key: "assets", icon: "🧰" },
  { path: "/activity", key: "activity", icon: "≡" },
  {
    path: "/reports",
    key: "reports",
    icon: "▤",
    visible: (c) => c.can("view_reports"),
  },
  {
    path: "/admin",
    key: "admin",
    icon: "⚙",
    visible: (c) => c.isAdmin,
  },
];

// The first four get dedicated mobile tabs; the rest live under "Other".
export const MOBILE_TAB_COUNT = 4;

export function visibleSections(current: CurrentUser): NavSection[] {
  return NAV_SECTIONS.filter((s) => !s.visible || s.visible(current));
}
