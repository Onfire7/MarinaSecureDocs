# Role Workflows

Per-role functional requirements, written as end-to-end narratives. Every behavior described here is a requirement on the implementation — the narrative form exists to keep the requirements in operational context, not to serve as staff training material. See [Page Specifications](pages/index.html) for exact screen-level behavior.

> **Note.** Remember a single person can hold multiple roles (see [Permissions](permissions.md)). These workflows describe each role's concerns in isolation; a real user's experience is the union of whichever roles they hold.

## Security

### Starting a shift

A guard starts their shift from the Home dashboard. This creates a Shift record and may itself be configured as a checklist trigger — for example, a "start of shift" checklist that asks the guard to select their patrol vehicle and log its current mileage.

### Working a tour

Depending on how the marina has configured its tours, the guard either:

- **Follows a fixed route (Linear tour)** — the app can show which checkpoint is next.
- **Works freely (Freeform tour)** — visits all required checkpoints in any order before shift end, with the app tracking which remain.
- **Follows app-directed randomization (Randomized tour)** — the app selects the next checkpoint (or small set of checkpoints) once the current one is complete, so patrol patterns aren't predictable to anyone watching the property.

### Checking in at a checkpoint

The guard taps their phone against an NFC tag (or scans a QR code) mounted at the checkpoint's location. This opens the checkpoint's unique URL, which immediately:

1. Logs the check-in — checkpoint, guard, and timestamp — capturing device GPS and validating it against the checkpoint's configured radius (flagging the check-in if it falls outside that radius, to guard against spoofing).
2. Surfaces whichever checklist template(s) apply right now, based on that checkpoint's configured triggers (e.g. a different checklist at night than during the day).
3. Presents the checklist for completion, and/or a place to add a note or log an incident, even if no checklist applies.

If a tag is missing or unreadable, the guard can manually check in instead — the app requires a short reason for the manual entry before proceeding, and this is recorded alongside the check-in.

### Working through a checklist

Each item on a checklist behaves according to its type:

| Item type | Guard experience |
|---|---|
| Simple Check | Tap to mark complete. Nothing further required. |
| Verify Task | Confirm the task was done by whoever was responsible, or reject it — either with a written reason, or by immediately raising a linked ticket. If configured, a rejection prompts the guard to attempt the task themselves before moving on. |
| Door Check / Lock Check | Select how the door (or bare lock — same check, but a lock is only Locked or Unlocked) was found — Open, Unlocked, or Locked. If that's the expected state, the item is done in one tap. If it isn't, the app logs an incident (prefilled, editable) recording that the door was wrong on arrival, then asks what state the guard left it in; if that's still not the expected state, it offers to raise a ticket. Found and left are stored separately, so a door corrected on arrival still reports as having been insecure — the app does not let a mismatch silently pass, or disappear once it's fixed. |
| Location-Based Check | Opens its own nested checklist scoped to that specific location before returning to the parent checklist. |

### Logging incidents and notes on the move

At any checkpoint, or from the Incidents section directly, a guard can log an incident (short title, expandable type, optional rich-text detail) or a quick note. Incidents can optionally be assigned to someone and can spawn a linked ticket on the spot. Everything the guard logs stays fully editable by them, without needing connectivity, until their shift ends — at which point their incidents lock to author-edits (though anyone with the create-incidents permission can still add comments).

### Handling slip/owner information

While viewing a slip or boat during a round, the guard sees whatever the marina has configured them to see — some marinas expose full owner contact information to security, others only the owner's name and let the office handle contact, per the `view_owner` / `view_contact` permissions.

### Ending a shift

If the marina has defined an end-of-shift checklist, completing and submitting it ends the shift automatically. Otherwise, the guard ends the shift manually from the dashboard. Either way, ending the shift triggers compilation of the shift report, emailed to the marina's configured distribution list.

## Maintenance

### Working the ticket queue

Tickets appear in a list sorted by priority (Urgent → Low). Depending on how the marina's maintenance department is structured, a worker either:

- Waits for a manager (or anyone with `assign_ticket_to_others`) to assign tickets to them, or
- Self-assigns tickets directly from the shared queue (`assign_ticket_to_self`), or
- Assigns tickets to teammates themselves, if the marina has granted `assign_ticket_to_others` more broadly.

A ticket carries whatever context it was created with — often a link back to an Incident, a note about which asset or location it concerns, and (for auto-generated tickets) which maintenance rule triggered it.

### Scheduled and reactive work side by side

Most maintenance work arrives reactively — someone (any role) files a ticket. Some arrives automatically: an asset with a meter (e.g. a patrol vehicle) generates a ticket on its own once its mileage or hours crosses a configured threshold since the last service, or once enough time has elapsed. Meter readings themselves come either from a checklist item (e.g. a guard logging vehicle mileage at shift end) or directly from the asset's own page.

### Asset condition & checkout

Maintenance staff are typically the ones updating an asset's status log (e.g. marking a vehicle Out of Service) and processing checkouts/returns for shared equipment — recording who has it and when it's expected back, even though any role can technically check an asset in or out if permitted.

## Office

### Handling calls

When a call comes in on a marina line, the office user sees a panel appear automatically — a right-side panel on desktop, a pop-up on mobile — showing the caller's matched contact, any active reservation, related slip/boat information, and prior call notes. They can add new notes during or after the call. If recording/transcription is enabled for the marina, that's available on the same screen once the call completes.

A floating badge elsewhere in the app shows a running count of missed calls and unread texts; tapping it opens the same kind of detail view, including a playback of any voicemail left.

### New or unmatched callers

If an inbound number doesn't match an existing Contact, a new Contact is created automatically. Whenever the office views a nameless contact, the app prompts for a name — and once entered, shows any similar existing contacts so the office can confirm a match and merge, rather than ending up with duplicate records for the same person.

### Reservations

The office manages bookings for whichever locations and assets the marina has configured to accept reservations — a cabin, an RV site, a short-term slip, a rental boat. A reservation captures the reserving contact, expected/actual check-in and check-out, and — for anything other than a purely internal reservation — rate, deposit, and balance. An upcoming reservation is shown prominently next to the location/asset so staff know it's coming, but its status doesn't change until the reservation actually begins (the guest checks in, or the asset goes out); when it ends, the location/asset lands in whatever post-reservation status it's configured for — a cabin to "Needs Cleaning," a jump pack to "Needs Charging."

### Owner, boat & lease records

The office is typically where owner and contact records get created and kept current, and where lease/contract details, variances, and documents live — gated by `edit_owner_contact`, `view_lease`, and `manage_lease` respectively.

### Creating tickets on behalf of customers

When an owner calls in a maintenance issue, the office logs it as a standard ticket — the same ticket-creation capability every role has by default — typically attached to the relevant boat or slip.

## Marina Manager / Owner

### Configuring the system to match how this marina actually runs

This is the role that shapes the platform for a specific property, through Admin:

- Defining roles and setting each one's trinary permissions (see [Permissions](permissions.md)).
- Adding/editing users and assigning roles.
- Defining location types and their valid parent relationships, and laying out the marina's actual locations (docks, slips, buildings, checkpoints).
- Building checklist templates and deciding which tour mode(s) to use.
- Defining asset maintenance rules, and which locations/assets accept reservations.
- Setting marina-wide defaults: GPS validation radius, Activity Log retention, call recording/transcription toggles, phone line routing, and the shift report distribution list.

### Oversight

Day to day, this role leans on Reports (shift summaries, incident history, ticket throughput, call logs) and the Activity Log for a full, chronological view of everything happening at the marina, scoped to whatever they have permission to see.

### Stepping into other roles

Because roles are additive, a hands-on owner-operator often holds Manager permissions alongside Office or Maintenance permissions directly, rather than needing a separate "do everything" account — the same multi-role mechanism available to any staff member.

## Comms: chat rooms (all roles)

Any user can start a topic-based chat room and invite specific users and/or roles into it. These are entirely internal and separate from call/SMS logging — no database relationship links a chat message to a customer call. Pasting a URL to a location, asset, contact, or similar into a chat message renders a lightweight preview card so the conversation stays legible, but that's link parsing for display, not a stored relationship. Anyone holding `view_all_chats` can see every room at the marina, invited or not — useful for a manager keeping a general eye on team communication — but that's read-only until they're an actual participant; `manage_chats` is the separate permission that lets a manager or department head add themselves, or someone else, into a room they weren't originally invited to. See [Permissions](permissions.md) and [Page Specifications — Chat Room](pages/chat-room.html).
