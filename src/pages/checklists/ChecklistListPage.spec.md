# Checklists — Checklist List

`/checklists`. The landing point for the Checklists nav item. The guard's
work queue: open checklists first, then each tour's remaining checkpoints
inline under a small heading, with finished work collapsed into the
background.

## Purpose

Surfaces anything a trigger generated that the user needs to act on: clock
in/out, checkpoint visit, recurring schedule, or a checklist started by hand.
This page is also where **recurring templates become real checklists**: there
is no server-side scheduler, so the first holder of a template's assigned
role to open the page on a matching day creates that day's instance
(deterministic id, so racing clients converge on one row). Instances still
inside their `hide_until` exist but are filtered out; they aren't anyone's
work yet.

**Ordering principle: open work in front, completed work in the background.**
Open checklists render as tappable cards, In Progress before Not Started,
since half-done work goes stale in a way unstarted work doesn't, each
labelled with its next action ("Continue" / "Start"). Completed checklists
collapse into a "Completed · N" disclosure at the bottom, capped to the most
recent 15; a glance back to confirm "that one went through" is all this
screen owes, with full history on Checklist Detail and in Reports. The
earlier design, a four-column status table defaulting to "All", buried the
row needing attention under the shift's completions, which only grow as the
night goes on.

## Layout

```
Checklists                      [Start a checklist… ▾] [Start checklist] [Check in manually]

┌ Start of Shift — Vehicle ──────────────┐  Tours (Security)
│ Clock In · In Progress        Continue │  ┌ Evening Round — Linear  3 left ─┐
└────────────────────────────────────────┘  │ ▸ Next: Dock C Gate             │
┌ Dock C Gate — Night Check ─────────────┐  │   Visited this shift · 4        │
│ Checkpoint · Not Started         Start │  └─────────────────────────────────┘
└────────────────────────────────────────┘
▸ Completed · 6
```

Mobile is one column: open checklists, then tour sections, then the collapsed
Completed disclosure. Desktop puts checklists and tours in adjacent columns
for users with tour access (Security); without it there is no second column,
so the freed width goes to density instead and open-checklist cards flow two
per row. There are no Checklists/Tours tabs: with tours inline there is
nothing to switch between.

## Data shown

| Field | Source | Notes |
|---|---|---|
| Template name | `checklist_instances.template_id` → `checklist_templates.name` | |
| Status | `checklist_instances.status` | Not Started / In Progress / Complete. |
| Trigger | `template.trigger_type` | A short label ("Manual", "Checkpoint", "Recurring", …). Instances don't store their own provenance; the activity log does. |
| Started / due | `started_at` / `due_by` | |

## Actions

| Action | Gating | Behavior |
|---|---|---|
| Open a Not Started / In Progress checklist | The `assigned_to` user, or a holder of the role it's assigned to | Opens Active Checklist (`ActiveChecklistPage.spec.md`). |
| Open a Complete checklist | Same | Opens Checklist Detail, read-only. |
| Expand Completed | None | A collapsed disclosure, not a filter: the split between open and done is the page's structure, so status filter chips do not exist. |
| Start a checklist | Any template whose `assigned_role` the user holds | See § Starting a checklist by hand. |
| Check in manually | Security | The manual check-in dialog. |
| Monitoring section | A role the user holds is in a template's viewer roles | Open instances of that template, read-only: who has it (or "unclaimed") and its status. Opens the checklist read-only; the office watching a maintenance checklist move without holding the role. Client-side only until the permissions overhaul. |
| Tour sections | Security | Inline below the open checklists, one section per tour under a small heading (name, mode, remaining badge, progress bar), per `docs/pages/tour-progress.html`, which specifies the per-mode rendering. Tours with remaining checkpoints sort above completed ones, which dim with "Complete ✓"; a tour's visited checkpoints collapse into a "Visited this shift · N" disclosure inside its section. Without an active shift the steps still list, with a note that progress starts with a shift. |

## Starting a checklist by hand

The picker in the page head lists every template whose assigned role the
user holds, in two groups:

- **Manual** templates first. These exist to be started here, as often as
  wanted.
- **Triggered** templates after, each labelled with its trigger ("Dock Walks
  · Clock In"). A triggered checklist normally arrives on its own, so this is
  the recovery path when it did not: a template added after the guard clocked
  in, a device that was offline, or a clock-in that failed to build it. A
  triggered template is **left out while an open instance of it is already
  the user's**, meaning assigned to them, or unclaimed for a role they hold,
  with status Not Started or In Progress. One that arrived by itself is not
  offered a second time; one that is complete may be started again.

Choosing one and pressing **Start checklist** materializes a full instance,
every eligible section and all of its items as rows, assigned to self when
`assigned_to_user` is set and otherwise left for the role to claim, and
opens it. The activity entry says who started it manually. A template with
nothing switched on right now is not started; the page says so, because
silently doing nothing after someone taps Start is worse than an empty
checklist would have been. The picker is hidden entirely when no template
matches the user's roles.

Until 2026-10-21 the picker offered Manual templates only, so a Clock In
checklist the Shift card failed to create had no way to be started at all.
The grouping and the skip rule are `manualStartOptions()` in
`src/lib/checklistStart.ts`.

## States & edge cases

- **Empty state.** No checklists currently apply, with distinct copy for
  "nothing assigned right now" and "you hold no roles with checklist
  assignments".
- **Role-pool instances** (template's `assigned_to_user` off). Every holder
  of the assigned role sees the same unclaimed instance until someone opens,
  and implicitly claims, it.
- **Nested sub-checklists**, spawned by a Location-Based Check item, are
  excluded via their `parent_item_id`; they are reached through their parent
  item, not this list.
