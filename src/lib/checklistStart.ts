import { triggerTypeLabel } from "./checklists";

/**
 * Which templates a person may start, and which clock-in creates.
 *
 * Both decisions used to be inline in their pages, and both were narrower
 * than they should have been: the Shift card took the *first* Clock In
 * template of the guard's role and dropped the rest, and the Checklists page
 * offered only Manual templates by hand, so a Clock In checklist the card
 * failed to create had no way to exist (DashboardPage.spec.md § The Shift
 * card; ChecklistListPage.spec.md § Starting a checklist by hand).
 */

export interface StartableTemplate {
  id: string;
  name: string;
  trigger_type: string;
  assigned_role_id?: string | null;
}

export interface OpenInstanceLike {
  template_id: string | null;
  assigned_to_id: string | null;
  status: string;
  /** The template's role, for the unclaimed-for-my-role case. */
  assigned_role_id?: string | null;
}

const OPEN = new Set(["not_started", "in_progress"]);

function mine<T extends StartableTemplate>(templates: T[], roleIds: string[]): T[] {
  return templates.filter(
    (t) => !!t.assigned_role_id && roleIds.includes(t.assigned_role_id),
  );
}

/**
 * Every Clock In template of the guard's roles with something to do, in name
 * order. All of them: a role may hold several, and each is a checklist the
 * guard owes.
 */
export function clockInTemplates<T extends StartableTemplate>(
  templates: T[],
  roleIds: string[],
  hasWork: (t: T) => boolean,
): T[] {
  return mine(templates, roleIds)
    .filter((t) => t.trigger_type === "clock_in" && hasWork(t))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface StartOption<T> {
  template: T;
  /** False for a triggered template: shown after the Manual ones, with its trigger. */
  manual: boolean;
  /** The trigger's display label; empty for Manual. */
  triggerLabel: string;
}

/**
 * What the Start picker offers: Manual templates first, then triggered ones
 * labelled with their trigger. A triggered template is left out while an
 * open instance of it is already the user's, assigned to them or unclaimed
 * for a role they hold, because one that arrived by itself should not be
 * offered a second time. A Manual template is never left out: it is started
 * here on purpose, as often as wanted.
 */
export function manualStartOptions<T extends StartableTemplate>(
  templates: T[],
  roleIds: string[],
  userId: string | undefined,
  instances: OpenInstanceLike[],
): StartOption<T>[] {
  const openOfMine = new Set(
    instances
      .filter(
        (i) =>
          OPEN.has(i.status) &&
          (i.assigned_to_id === userId ||
            (i.assigned_to_id == null &&
              !!i.assigned_role_id &&
              roleIds.includes(i.assigned_role_id))),
      )
      .map((i) => i.template_id),
  );
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const own = mine(templates, roleIds);
  const manual = own.filter((t) => t.trigger_type === "manual").sort(byName);
  const triggered = own
    .filter((t) => t.trigger_type !== "manual" && !openOfMine.has(t.id))
    .sort(byName);
  return [
    ...manual.map((template) => ({ template, manual: true, triggerLabel: "" })),
    ...triggered.map((template) => ({
      template,
      manual: false,
      triggerLabel: triggerTypeLabel(template.trigger_type),
    })),
  ];
}
