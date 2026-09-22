# Save indicator

Always visible while signed in: in the app bar on a phone, in the sidebar on a
desktop. It answers one question a guard should never have to take on trust —
**has what I just did reached the office?**

It exists because of a night when it hadn't. Checklist answers made in a dead
spot were discarded on reconnect and then erased from the phone; the guard had
watched every one of them save. The defect is fixed (see CLAUDE.md, "A 401 is
never a reason to discard a queued write"), but the lesson is wider than the
defect: work that is saved on the phone and work that has reached Postgres
looked identical, so nobody could tell which they had.

## What it reads

- The device's upload queue — `count(*)` of `ps_crud` — through
  `src/data/sync.ts`. Pages and layout never touch the database.
- PowerSync's status: `connected`, `uploading`, and the last upload error.
- Rejected writes, kept on the device in `localStorage`
  (`src/lib/db/rejectedWrites.ts`). No schema.

The state itself is decided by a pure function, `saveState()` in
`src/lib/saveState.ts`, which is where the tests are.

## States

Checked in this order; the first that applies wins.

| State | When | Shows | Tone |
|---|---|---|---|
| rejected | any rejected write not yet dismissed | `N change(s) rejected by the office` | danger |
| stuck | queue not empty, connected, and the queue has not shrunk for 60s (5 min if the only error is an expired token) | `N change(s) not sending` | danger |
| sending | queue not empty and connected | `Sending N change(s)…` | quiet |
| waiting | queue not empty and not connected | `N change(s) saved here` | amber |
| sent | queue empty | `✓ All changes sent` | quiet |

**Waiting is not an error.** It is the normal condition of a guard in a dead
spot and must never read as alarming — the wording says the work is *saved*,
because it is. "Here" rather than "on this phone": the same indicator sits in
a desktop sidebar, where the pill is narrow and the device is not a phone.

**An expired token is not stuck.** Tokens live 60 seconds; a phone waking from
sleep is refused once and recovers by itself. Only if that persists for five
minutes is something actually wrong.

## Tapping it

Opens a panel with the plain-language detail: how many changes are queued, the
real upload error when stuck, and each rejected write — what it was, when, and
the office's reason verbatim — with a **Dismiss** button. Rejections persist
across reloads until dismissed; a rejected write is work that is *gone*, and
the person who did it must get the chance to redo it.

## Rejected writes

The connector discards a write the office refuses for good (a constraint
violation, or an RLS refusal made *with* an identity) so that one bad write
cannot block every write queued behind it. Before this indicator that was a
`console.error` and nothing else — the same quiet loss, by a different road.
The discard stays; the silence does not.
