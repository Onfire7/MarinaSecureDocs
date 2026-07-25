import type { CurrentUser } from "../lib/auth/useCurrentUser";

export interface NavSection {
  path: string;
  label: string;
  icon: string; // emoji glyph for the mobile tab bar
  /** Omit from nav unless this returns true. Absent = visible to everyone. */
  visible?: (current: CurrentUser) => boolean;
}

// Top-level sections, in sidenav order (see wireframes/dashboard.html).
export const NAV_SECTIONS: NavSection[] = [
  { path: "/", label: "Home", icon: "⌂" },
  { path: "/checklists", label: "Checklists", icon: "☑" },
  { path: "/locations", label: "Locations", icon: "⚓" },
  { path: "/comms", label: "Comms", icon: "☎" },
  { path: "/tickets", label: "Tickets", icon: "🔧" },
  {
    path: "/incidents",
    label: "Incidents",
    icon: "⚠",
    visible: (c) => c.can("view_incidents") || c.can("create_incidents"),
  },
  { path: "/reservations", label: "Reservations", icon: "📅" },
  { path: "/boats", label: "Boats", icon: "⛵" },
  { path: "/contacts", label: "Owners & Contacts", icon: "👤" },
  { path: "/assets", label: "Assets", icon: "🧰" },
  { path: "/activity", label: "Activity Log", icon: "≡" },
  {
    path: "/reports",
    label: "Reports",
    icon: "▤",
    visible: (c) => c.can("view_reports"),
  },
  {
    path: "/admin",
    label: "Admin",
    icon: "⚙",
    visible: (c) => c.isAdmin,
  },
];

// The first four get dedicated mobile tabs; the rest live under "Other".
export const MOBILE_TAB_COUNT = 4;

export function visibleSections(current: CurrentUser): NavSection[] {
  return NAV_SECTIONS.filter((s) => !s.visible || s.visible(current));
}
