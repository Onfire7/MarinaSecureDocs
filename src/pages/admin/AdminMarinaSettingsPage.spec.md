# Admin — Marina Settings

`/admin/settings`. `manage_marina_settings`, enforced by the app
(ADR 0002). In the database `marina_settings` is baseline-tier: any active
marina user may write it.

The single settings record that lets one codebase serve very
differently-run properties. There is exactly one row per marina
(`marina_settings`, a singleton with `id = 1`), not a list, and every edit
takes effect immediately, with no publish or staging step.

## Fields

| Field | Source | Notes |
|---|---|---|
| Marina name | `marina_name` | Shown in the sidenav and on reports. Falls back to "Marina" until the row syncs. |
| Language | `language` | The **data language** (`docs/localization.md`): what the app writes stored text in, such as Activity Log summaries, auto-raised ticket titles and default names. It is not the UI language, which each person picks for themselves on the More page. Lists every language with a catalog, each in its own name. Defaults to `en`. |
| GPS validation radius default (m) | `gps_validation_radius_default` | Used by any checkpoint without its own override. |
| Audit GPS radius (m) | `audit_gps_radius` | An audit asks for new coordinates when the device is farther than this from a location's pin. |
| Audit GPS accuracy limit (m) | `audit_gps_accuracy` | A capture is refused when the device's own accuracy is worse than this. |
| Activity Log retention (days) | `activity_log_retention_days` | Entries older than this are purged by the scheduled job unless flagged Protected. |
| Calls | `call_recording_enabled` / `call_transcription_enabled` | Whether the Active Call Panel and call history ever show a recording or transcript. |
| Reservations | `allow_overlapping_reservations` | Off by default, which makes New Reservation block a booking whose dates overlap another for the same target. On permits it (waitlist and overbooking models). |
| Haul-out mode | `haul_out_mode` | Ask (default) or Customer. Ask makes Boat Detail's haul-out prompt for marina or customer; Customer assumes customer. A marina haul-out raises a Ticket and a customer one doesn't. |
| Shift report recipients | `shift_report_recipients` | The End of Shift report's email list. Add an address, or Remove one. |
| Phone lines | `phone_lines` (own table) | Number and label per line. Adding a line records a Twilio number that must already exist on the marina's Twilio account. This screen does not provision it. |

Required numeric fields ignore a cleared box rather than writing nothing.

## States & edge cases

- **Lowering retention** takes effect at the next scheduled purge, not the
  moment it is saved.
- **Removing the last phone line** asks for confirmation first, since
  calling and texting then have no number to route through.
- **Empty shift report recipients.** The report still compiles and has
  nowhere to go. A warning appears inline beside the field, here and only
  here. It is never a banner elsewhere, and it doesn't block saving.
- **Changing the language** affects text written from then on. Records
  already written stay in the language they were written in.

## Layout

Two columns on desktop: identity, language, GPS, retention, calls,
reservations and haul-out on the left; recipients and phone lines on the
right. One column on mobile. It is an infrequent configuration task, so
there is no special mobile treatment.
