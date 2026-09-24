# Audit wizard

`/audits/:id/wizard`. The walking tool: pick what this run asks about, then
go through the audit's locations answering one item at a time. Behaviour is
`docs/audits.md` § The wizard; this file records what the page commits to.
Settled by prototype on 2026-09-23 (branch `prototype/audit-wizard`, four
variants; this is D).

- **Open audits only.** A closed or finalized audit shows "This audit is
  closed. A wizard records Findings, and a closed audit accepts none." with
  a way back. No permission beyond seeing the audit: anyone who may record a
  Finding may run one.

## Setup

- **Every item, grouped, all selected.** Status (or Occupancy), Attributes,
  Services, Amenities, Questions, Checks, GPS — the order the rest of the
  app uses. Each group's heading is a checkbox that takes the whole group
  and goes indeterminate when part of it is on.
- **Locations**: *Still to do* (targets not yet audited) by default, or
  *All, including audited* to amend.
- The footer counts the run — "12 locations · 147 steps" — and *Start* is
  disabled when the selection would ask nothing.
- The selection lives as long as the screen. Nothing is stored; a new run is
  a few taps.

## Running — phone

- **One item per screen**, headed by the location: its name as the page's
  `h1`, the type under it, then a rule in the text colour that fades out at
  both ends,
  then the item's group and the item -
  which location is being edited should never be in doubt, and the pager at
  the foot is too far from the question to answer it. The items of a
  location are screen-sized pages stacked vertically; locations sit side by
  side.
- **Vertical moves** — swipe, wheel, the rail's arrows, a tapped answer —
  land on a page over **500ms**, easing. Free scrolling snaps a page at a
  time. Mandatory scroll-snap re-snaps every frame a programmatic scroll
  writes, so snapping is suspended for the length of a tween (CLAUDE.md).
- **Horizontal moves** — the pager, the jump list, rolling off either end —
  slide over **500ms**, however far apart the locations are; a jump from the
  first to the fortieth is one slide, not thirty-nine.
- **Rolling over.** Pushing past the last item goes to the next location's
  first item; pushing past the first goes to the previous location's **last**
  item, so the run reads as one ribbon. There is no horizontal swipe: a
  stray sideways drag should not skip a site.
- **The rail** down the left edge is one pip per item — grey untouched, dim
  for a value that is only what is on file, green for what this run
  answered, accent for where you are — capped with ▲ and ▼, which are both
  the affordance and buttons. Tapping a pip goes to its item.
- **Answering moves to the next logical field.** A Service found *Present*
  reveals its working box and note and focuses the note; toggling *working*
  does the same; a choice Attribute focuses its note; a number field's Next
  moves to the note and the note's Next moves to the next item. An answer
  with nothing behind it — *Absent*, a Yes/No, a status — moves straight on.
- **Fields take focus on arrival**, so a number is typed without reaching
  for the screen. Numbers use a decimal keyboard; every field's Enter key is
  `next`. **A page with nothing to type into takes focus away**, so the
  keyboard goes rather than standing over a page of buttons because the
  page before it had a note.
  - Focus already inside the current page is **left alone**. This runs again
    on every re-render and a write causes one, so without that guard, Next
    from a number to its note was undone a moment later by the page taking
    focus back to the number.
  - Focus belonging to a page the run has left is dropped, which is what
    dismisses the keyboard.
- **The keyboard does not resize the viewport.** It is allowed to cover the
  pager - there is nothing to do down there while typing. What it must not
  cover is the question, so **the scroller ends where the keyboard starts**:
  it takes the height `visiblePageHeight()` reports from
  `window.visualViewport`, animated over **250ms**, and a page is 100% of
  it, so the question stays centred in what is left. The pip rail is bound
  to the same height, or it centres itself behind the keyboard. A scroller
  that carried on underneath would put half of every gesture in a region
  the browser must pan to before anything scrolls - which is what going to
  the next item felt like before it was bounded.
  - The page being answered is held against the top of the scroller for the
    length of that animation, snapping suspended, or every page moving at
    once would carry it off.
  - The scroller has `overscroll-behavior: contain` and the document is
    locked while a run is open: a document that can scroll is one the
    browser will scroll when the keyboard opens, and the next swipe goes
    into putting it back.
  - A keyboard shorter than the pager costs the run nothing.
- The bottom bar is the pager: ◀, the location name (tap to jump), ▶, over a
  background tinted green from the left with the run's progress.

## Running — desktop (≥900px)

- The filmstrip gives way to **the whole location on one page**, items
  stacked under their group headings with the same controls, and the
  **jump list as a right-hand sidebar** with the pager at its foot. There is
  no reason to scroll a screen at a time on a machine that can show the lot.

## Jumping

- Search over name and type, and *Still to do* / *Done* / *All* with counts.
  A row shows the location, its type, and either how many of its items this
  run has answered or how many it has.
- Done means a Finding exists, or this run has answered something here.

## Saving

- **Every answer is written as it is made**, through
  `src/data/auditWizard.ts`, which merges: only the item just answered is
  touched. The footer says *Saved as you go*, or what went wrong.
- **A page that changed nothing writes nothing.** A tap always counts -
  answering that a Service is present is a confirmation even when it
  already was - but a field only writes what differs from what it held when
  the run arrived. The run focuses a field when it lands on its item and
  blurs it on the way out, so without that rule, scrolling through a
  location would commit every number back to itself, and the first write is
  what creates the Finding. Scrolling is not auditing.
- The first answer at a location creates its Finding, which marks it
  audited. Partial runs are expected; the audit page's unanswered pills are
  what say the rest is open.
- Progress counts **what this run touched**, never what merely has a value.
