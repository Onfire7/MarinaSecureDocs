import type { Permission } from "../../lib/permissions";

// Admin sub-sections and their gates (see docs/pages/admin-home.html).
// Several reuse an existing permission rather than introducing a dedicated
// one — Tours under manage_locations because a tour is a composition of
// checkpoints, Incident Types under create_incidents because that permission
// already allows inline type creation, SMS Templates under
// manage_marina_settings as the closest fit in the fixed catalog.
export interface AdminSection {
  path: string;
  label: string;
  description: string;
  requires: Permission;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    path: "/admin/users",
    label: "Users",
    description: "Invite, edit, deactivate, and assign roles",
    requires: "manage_users",
  },
  {
    path: "/admin/roles",
    label: "Roles & Permissions",
    description: "The trinary permission matrix",
    requires: "manage_roles",
  },
  {
    path: "/admin/checklist-templates",
    label: "Checklist Templates",
    description: "Items, triggers, and assignment",
    requires: "manage_checklists",
  },
  {
    path: "/admin/locations",
    label: "Location Types & Locations",
    description: "Hierarchy, checkpoints, maps and plotting",
    requires: "manage_locations",
  },
  {
    path: "/admin/setup",
    label: "Marina Setup Wizard",
    description: "Build out docks and their slips, checkpoints, and a tour in one pass",
    requires: "manage_locations",
  },
  {
    path: "/admin/checkpoints",
    label: "Checkpoints",
    description: "Every checkpoint at once — bulk create, GPS, usage",
    requires: "manage_locations",
  },
  {
    path: "/admin/tours",
    label: "Tours",
    description: "Checkpoint sets and sequencing mode",
    requires: "manage_locations",
  },
  {
    path: "/admin/incident-types",
    label: "Incident Types",
    description: "Rename, merge, and tidy the type list",
    requires: "create_incidents",
  },
  {
    path: "/admin/assets",
    label: "Asset Categories & Maintenance Rules",
    description: "Groupings and auto-ticket thresholds",
    requires: "manage_assets",
  },
  {
    path: "/admin/sms-templates",
    label: "SMS Templates",
    description: "Marina-wide reply templates",
    requires: "manage_marina_settings",
  },
  {
    path: "/admin/settings",
    label: "Marina Settings",
    description: "GPS default, retention, phone lines, recipients",
    requires: "manage_marina_settings",
  },
];
