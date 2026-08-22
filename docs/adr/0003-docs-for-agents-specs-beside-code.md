# Documentation targets agents, and page specs live beside their components

The documentation was authored as a browsable HTML site because it was
steering a planning phase that needed to be read and reviewed in a browser.
That phase is over. The readers now are the agents and developers building the
application, who work in the repo — so the docs become Markdown, GitHub Pages
is retired, and each page's specification moves next to the component it
describes as `ComponentName.spec.md`.

## Why co-location rather than a docs tree

An audit found 19 page specs that no source file referenced, a reference to a
spec file that didn't exist, and a glossary that had drifted from the data
model on two separate points. The convention "update the spec and the code
together" was already written down and was being followed roughly two-thirds
of the time.

Location is what fixes that, not format. A spec beside its component is in the
diff, in the file listing, and in context when the component is opened — and
the two structural failures become mechanically checkable: a `.spec.md` with
no sibling component is an orphan, a component with no `.spec.md` is a gap.
The cross-cutting documents have no single component to sit beside, so they
stay in `docs/`.

## Consequences

- The cross-cutting docs converted in one pass, because they held every
  contradiction the audit found and fixing content and format separately would
  have meant reading them twice.
- The 59 page specs convert one at a time, as each page is next touched.
  Unlike the top-level docs they had been moving with the code and were
  accurate, so converting them all at once would risk the only part of the
  documentation currently worth trusting.
- Wireframes fold into their specs rather than being deleted. Every screen is
  built, so their prototyping value is spent — but their per-state field
  inventories are the most precise record of what is absent when, and that
  detail is what a rewrite loses silently.
