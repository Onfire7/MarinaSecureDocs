# Shift Report

`/reports/shifts/:id`. A compiled report of one guard's Shift, and resending
it.

The Shift Report's settled redesign (a body fixed at End of Shift, the End of
Shift Note, the Report Link) is in `CONTEXT.md` and ADR 0008 and is not
built yet; this spec describes the page as it is, plus its **Vehicles**
section. When the redesign lands, Vehicles moves into the fixed body
unchanged.

## Purpose

Reached from Reports home. Shows the same content that was, or will be,
emailed to the marina's `marina_settings.shift_report_recipients`
(`docs/architecture.md` § Shift report delivery).

## Data shown

| Field | Source | Notes |
|---|---|---|
| Guard, shift window | `shifts.guard_id` / `started_at` / `ended_at` | |
| Delivery status | `shifts.report_sent_at` | Null means not sent yet: still within the shift, or waiting on the scheduled backstop sweep if the shift ended offline. |
| Check-ins, checklists, incidents, tickets | Rows whose timestamps fall within the shift's window | Association by timestamp, not by a Shift reference (`docs/data-model.md` § Shift). Incidents only with `view_incidents`. |
| Vehicles | § Vehicles | |

## Vehicles

Every use of a Fleet Vehicle by this guard during the Shift, however it was
recorded: the Fleet card, a Fleet Vehicle Item, or Asset Detail. "This
guard" means a checkout whose person is the guard's linked Contact, and fuel
and status records the guard logged.

One entry per trip (checkout), and one for each vehicle only fueled or
checked, ordered by first use:

- **Name**, and the time span: "{out} – {in}", or "{out} – still out", or
  "{out} – kept past End of Shift". A checkout begun before the Shift
  started shows its real time out; one continued from an earlier Shift's
  Kept Vehicle reads "kept from the previous shift" in place of a time out.
- **Odometer**: "{out} → {in} (+{n} mi)", ending at the check-in (for a
  kept vehicle, the reading taken at End of Shift), or at the latest reading
  so far. Omitted for a vehicle with no meter. In the vehicle's own unit
  (miles or hours).
- **Fuel**: the level it came back with, or, when kept, the level recorded
  at End of Shift.
- **Fill-ups** the guard logged on it in the window: "⛽ {gallons} gal at
  {time}", with cost if given.
- **Status Checks** the guard recorded on it: "{time}: {odometer}, fuel
  {level}". They appear as soon as they are recorded, so a supervisor
  reading mid-shift sees the vehicle as it is now.
- **Return note**, quoted; for a kept vehicle, that note is the reason it
  was kept, labelled "Kept: …".

A vehicle the guard only fueled or status-checked, without holding it, still
gets an entry, with no time span. With no vehicle use at all the section
reads "No vehicle used this shift." It is not gated: fleet use is not
sensitive, and the report already goes to the guard's supervisor.

Which records count:

- **Checkouts** whose person is the guard's Contact and whose span overlaps
  the window (out before the window ends, and in after it starts or not in).
- **Fuel log rows** (`asset_fuel_logs`) logged by the guard inside the
  window.
- **Kept vehicles**: a checkout closed during the window that is followed,
  at the same moment, by a `kept_after_shift` checkout of the same vehicle
  to the same person. It reads as kept, not returned.

The End of Shift review (`/shift/end`) shows this same section, so the guard
sees what the report will say before ending the shift.

## Actions

| Action | Gating | Behaviour |
|---|---|---|
| Resend | The shift's own guard, or `view_reports` | Calls `POST /reports/shift/:shiftId/send` (`docs/api-structure.md`), the same function as the original send. It compiles fresh from current data and hands off to the Twilio Function, which sends through SendGrid and sets `report_sent_at`. |

## States and edge cases

- **Not sent yet.** A pending badge rather than a blank status; the content
  is fully viewable, compiled live.
- **Resend while offline.** Disabled: sending is online-only. The content
  stays viewable offline.
- **Content changes after the shift ends** (a late incident comment, a kept
  vehicle checked in the next morning). Viewing always compiles fresh, so it
  can show more than the email did; a resend captures the current state. A
  kept vehicle still reads "kept past End of Shift" with its End of Shift
  readings, because those are what this Shift handed over; the check-in
  belongs to whoever's Shift it fell in.
- **Guard with no linked Contact.** Checkouts can't be matched to them, so
  only fuel and status records appear.

## Mobile and desktop

The same read-only layout at any width: two columns on desktop, one on a
phone. Vehicles sits in the first column, under Checklists.
