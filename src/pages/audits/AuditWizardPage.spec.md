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
  Services, Amenities, Questions, GPS, Checks — the order the rest of the
  app uses, with GPS before the Checks (owner, 2026-10-04) because a
  captured fix is also where the location is anchored on the map. Each group's heading is a checkbox that takes the whole group
  and goes indeterminate when part of it is on.
- *Confirm this location is done* is one of those items, offered under
  Status (Occupancy on an occupancy audit) and turned off like any other.
  Wherever it is offered, it is asked **last**.
- **Locations**: *Still to do* (targets not yet audited) by default, or
  *All, including audited* to amend.
- The footer counts the run — "12 locations · 147 steps" — and *Start* is
  disabled when the selection would ask nothing.
- The selection lives as long as the screen. Nothing is stored; a new run is
  a few taps.

## Running — phone

- **One page per screen**, headed by the location: its name as the page's
  `h1`, the type under it, then a rule in the text colour that fades out at
  both ends, then the page's group and label - which location is being
  edited should never be in doubt, and the pager at the foot is too far
  from the question to answer it. The pages of a location are screen-sized,
  stacked vertically; locations sit side by side.
- **A page is one item, except Attributes, Services and Amenities, which
  are one page per group** with every item of it listed, the way the
  Finding form lists them (owner, 2026-10-04: it is faster to tap them in
  the order they are seen than to find each one as it comes up). The list
  scrolls inside the page; a *Next* at its foot moves on, as does a swipe.
  Progress and the pips count items, not pages: a Services page of six is
  six taps, and its pip is green once any of them is answered here.
- **The column is not a scroller the browser drives.** It is
  `overflow: hidden` and the run writes its scroll position itself, so
  there is no fling, no momentum and no snap - and nothing to fight the
  tween for the position, which is where every scrolling bug before
  2026-10-04 came from. (Settled with the owner that day: "make the changes
  and see if it feels better".)
  - **A swipe carries the page with the thumb at 5×** - a fifth of a screen
    of thumb is a whole page - and **stops dead at the next page**, whatever
    the thumb does afterwards. On release the nearest page wins: past half
    way (about 75px of thumb) the page turns, short of that it goes back.
    One swipe is one page, never two.
  - **A wheel burst is one page.** There is no release to decide on, so the
    first 40 units of delta turn the page and the rest of the burst is
    ignored for 250ms.
  - Pressure against the end of the column - thumb travel past where the
    page stopped - rolls into the neighbouring location after 60px.
  - The index is told about a swipe only **after** the page has landed. The
    index change is what focuses the page's field, and a field focused
    before its page arrives is one the browser scrolls into view itself,
    against the tween. Focus is taken with `preventScroll` for the same
    reason.
- **Vertical moves** — the rail's arrows, a tapped answer, a wheel burst —
  land on a page over **500ms**, easing. That landing is keyed to the step
  **index**, never to the identity of the step object: the object is rebuilt
  whenever any query behind the catalogue re-emits, which a PowerSync query
  does every time anything it touches changes - including the answer just
  written. Keyed to identity, a write landing mid-swipe tweened the page
  back out from under the thumb, several times per swipe. A thumb landing
  mid-tween stops it and takes the page from where it is.
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
- **The map page shows the map, and the question under it.** The Finding
  form's placement check: the map the location is plotted on, its anchor
  dot and label highlighted, every other label muted, and the device's own
  position when the map's fit can place it; under it *Is it placed
  correctly on the map?* - asked **only when it is on the map**. A location
  that is not on any map yet gets no question, just *Place it on the map*
  (owner, 2026-10-04). Yes moves on. No opens the editor, since No is
  answered by moving it; so does tapping the map.
  - **The editor is fullscreen and zooms** (`shared/MapLabelEditor.tsx`,
    also the Finding form's and the admin plotter's): pinch or wheel to
    zoom, one finger pans, the label and the anchor dot drag, or a tap
    places it when it is not on the map yet. The bar under the map is one
    icon per setting - Label (the offset from the anchor), Anchor, Size,
    Width, Height, Angle - and tapping one shows its slider
    alone, with the label brought into the top third of the screen so the
    slider's effect is seen while the thumb is on it. *Done* keeps the
    label; *Cancel* changes nothing.
  - **The style a label is finished with is remembered on this device**
    (`lib/mapLabelStyle.ts`, local storage - the owner's choice over a
    marina setting), offset included, and the next label placed starts in
    it. A label for a location whose anchor was just tapped starts on that
    anchor, saved or not.
  - A move of a label that was on the map is a `move_placement` Proposal,
    written with the answer, replaced by the next move and removed by
    *discard* - every other user navigates by that map, so it waits for
    approval - and it answers No. Placing one that was not on the map
    proposes the same and answers nothing: the question was never asked.
- **The GPS page is asked at every location, pin or no pin**, and it is
  the Finding form's capture: the device's accuracy, where the pin is and
  how far the device is from it (or that there is none), the *I am
  standing directly at …* tick, and *Use my position*, enabled under the
  same rules — accuracy within the marina's limit, the tick ticked. The
  fix is a `set_gps` Proposal; *discard* removes it. (Before 2026-10-04 a
  pinned location was skipped, and the page itself was a stub that wrote
  the word "captured" as the Proposal.)
  - **Capturing opens the map in anchor mode: zoom in, tap where you are.**
    The tap ties the fix to the map (`docs/maps.md`); it rides on the
    answer and is written as a `move_placement` Proposal beside the
    `set_gps` one - the existing placement re-anchored with its label kept,
    or a new one in the remembered label style. Cancel keeps the fix and
    ties nothing; *Tap where I am on the map* offers it again.
- **No Next button under a field** (owner, 2026-10-04, reversing the same
  morning's addition): the keyboard's Next key, a swipe and the rail move
  on. The one Next is at the foot of a section page's list.
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

## Confirming a location

- **The last page of a location is the location** — a page like every
  other, one screen tall, with the review scrolling **inside** it and the
  sign-off pinned under it. A swipe over the review scrolls the review,
  natively - the list is its own scroll container, so the run's
  `touch-action: none` does not reach it; when it has nothing left in the
  direction the thumb is going, the run takes the gesture. (Made taller
  than the screen it could not be rested in: one swipe crossed the whole
  review and rolled into the next location, and every piece of arithmetic
  here assumes a page is a screen.) Every item this audit
  asks about it — not just the ones this run selected — with what is
  recorded against each: this run's answer, else the earlier pass's, else
  what is on file. An item with nothing behind it reads *not answered*, in
  italics, and the foot counts them: a gap is seen before the sign-off, not
  afterwards on the audit page.
- **Confirming is what marks the location audited**, and it is the only
  thing that does. It writes `audit_findings.confirmed_at`; a database
  trigger moves the target between `pending` and `audited` to match, and
  the audit closes itself when the last location is confirmed rather than
  when the last answer lands. Confirming moves the run on to the next
  location.
- Returning to a confirmed location shows **Audited** and a *Reopen*,
  which clears the stamp and puts it back in the queue with every answer
  still recorded. Several passes can accumulate and the sign-off happens
  once.
- **A run with the page turned off confirms on the first answer**, as the
  wizard did before this page existed: such a run has no other moment to
  say a location is done. An existing Finding is left as it stands either
  way — a second pass over a confirmed location does not reopen it.

## Jumping

- Search over name and type, and *Still to do* / *Done* / *All* with counts.
  A row shows the location, its type, and either how many of its items this
  run has answered or how many it has.
- Done means the location has been confirmed, or this run has answered
  something here. A location with a pass of answers against it and no
  confirmation is still to do.

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
- The first answer at a location creates its Finding, **unconfirmed** when
  the run carries a confirmation page. Partial runs are the expectation,
  not the exception; recording is not finishing.
- **Arriving at a location shows what is already recorded there**, not just
  what is on file. An earlier pass's Service, Amenity, Question, check or
  Attribute value is seeded over the Location's own row — a presence or an
  attribute the audit recorded is waiting in a Proposal, and the Location
  will go on saying otherwise until someone approves it.
- Progress counts **what this run touched**, never what merely has a value.
