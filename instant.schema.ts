// MarinaSecure — InstantDB schema.
// Mirrors the entities in docs/data-model.html.
// Field names are camelCase here; the docs use snake_case for the same fields.
//
// Conventions:
// - "Exactly one attachment target" (Note / Incident / Ticket → Location |
//   Checkpoint | Boat | Contact | Asset) is modeled as five optional links;
//   the app enforces that exactly one is set.
// - Ordered ref[] lists (tour checkpoints, boat owner succession) carry a
//   sibling `…Order` json field of ids, since links are unordered sets.
// - Enum-ish fields are lowercase snake strings ("under_review"), mapped to
//   display labels in the frontend.

import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),

    // ---- people & access ----
    users: i.entity({
      name: i.string(),
      email: i.string().unique().indexed().optional(),
      phone: i.string().optional(),
      clerkUserId: i.string().unique().indexed().optional(),
      active: i.boolean(),
      // Ordered [{ card, visible }] pairs; null = derive from current roles.
      dashboardLayout: i.json<{ card: string; visible: boolean }[]>().optional(),
      // Denormalized copies of two effective permissions (allow minus deny
      // across every currently-held role — see lib/permissions.ts),
      // rewritten by Admin Roles/Users whenever a role's grants or this
      // user's role links change. Plain booleans rather than a permission
      // array: instant.perms.ts rules can only reach these via a single-hop
      // auth.ref() to a scalar attribute (the same pattern already proven
      // with `active`) — whether auth.ref() flattens a JSON array attribute
      // or returns a list-of-lists is undocumented, so the rules never read
      // one. Only these two are cached because they're the only permissions
      // enforced server-side today; see instant.perms.ts.
      canManageRoles: i.boolean().optional(),
      canManageUsers: i.boolean().optional(),
    }),
    roles: i.entity({
      name: i.string(),
      // Permission keys this role grants / explicitly denies. Was a single
      // map<Permission, "allow"|"deny">; split into two plain string arrays
      // because InstantDB's CEL permission rules can test list membership
      // ("x" in data.ref(...)) but can't index into a JSON map — a rule
      // needs "is this key present in this list", not "what's the value at
      // this key". Absent from both = undefined (no opinion), matching the
      // trinary model exactly.
      allow: i.json<string[]>().optional(),
      deny: i.json<string[]>().optional(),
    }),

    // ---- locations & checkpoints ----
    locationTypes: i.entity({
      name: i.string(),
      allowsReservations: i.boolean(),
      // Optional (not required) so rows created before these flags existed
      // stay valid; absent = false.
      hasBoat: i.boolean().optional(),
      hasVehicle: i.boolean().optional(),
      // Whether Locations of this type carry an occupancy status at all —
      // off for organizational containers (a root property, a dock that only
      // groups slips), which would otherwise read a meaningless "Vacant".
      tracksStatus: i.boolean().optional(),
    }),
    locations: i.entity({
      name: i.string(),
      // occupied / vacant / reserved / out_of_service / needs_cleaning /
      // admin-defined. Absent entirely when the type doesn't track status.
      status: i.string().optional(),
      reservationEnabled: i.boolean(),
      reservationVisibility: i.string().optional(), // public / internal
      postReservationStatus: i.string().optional(),
      gpsLat: i.number().optional(),
      gpsLng: i.number().optional(),
    }),
    marinaMaps: i.entity({
      name: i.string(),
    }),
    locationMapPlacements: i.entity({
      // Center point as percentages (0–100) of the map image — genuinely
      // relative, so this is the one part of the shape percent still suits.
      // Everything else about the rectangle's size is intrinsic to its
      // label text (font size + padding around it) rather than an absolute
      // percent extent, so rotation just rotates a normally-sized box
      // instead of stretching two independent axes. Old rows may still
      // carry the retired width/height percent fields; they're ignored,
      // not migrated (harmless leftover keys in an opaque JSON blob).
      // fontSize/paddingX/paddingY are optional so old rows fall back to
      // sane defaults (see lib/locations.ts — DEFAULT_PLACEMENT_STYLE).
      placement: i.json<{
        cx: number;
        cy: number;
        rotation: number;
        fontSize?: number;
        paddingX?: number;
        paddingY?: number;
      }>(),
    }),
    checkpoints: i.entity({
      name: i.string(),
      guidUrl: i.string().unique().indexed(),
      gpsLat: i.number().optional(),
      gpsLng: i.number().optional(),
      gpsValidationRadius: i.number().optional(), // meters; overrides marina default
    }),
    tours: i.entity({
      name: i.string(),
      mode: i.string(), // linear / freeform / randomized
      checkpointOrder: i.json<string[]>().optional(), // ordering for linear mode
    }),
    checkIns: i.entity({
      timestamp: i.date().indexed(),
      method: i.string(), // scanned / manual
      reason: i.string().optional(), // required when method = manual
      gpsLat: i.number().optional(),
      gpsLng: i.number().optional(),
      withinRadius: i.boolean().optional(),
    }),

    // ---- checklists ----
    // Templates are authored per role and instantiated as fully materialized
    // copies: every section and item of an instance exists as a row from the
    // moment it's assigned, so display logic only ever renders rows. Trigger
    // rules decide IF a row gets created; hideUntil decides WHEN it becomes
    // visible — and once visible, nothing ever re-hides.
    checklistTemplates: i.entity({
      name: i.string(),
      triggerType: i.string().indexed(), // manual / clock_in / clock_out / checkpoint / recurring
      triggerConfig: i.json<Record<string, unknown>>().optional(), // recurring: { recurrenceRule: RRULE }
      // true: the instance is assigned to whoever triggered it; false: left
      // unclaimed for any holder of assignedRole to pick up.
      assignedToUser: i.boolean(),
      hideUntilRule: i.string().optional(), // "HH:MM" → resolved to instance.hideUntil at creation
      dueBy: i
        .json<{ kind: "time"; time: string } | { kind: "offset"; minutes: number }>()
        .optional(), // resolved to instance.dueBy at creation
    }),
    checklistTemplateSections: i.entity({
      name: i.string(),
      order: i.number(),
      isActive: i.boolean(), // authoring switch: inactive sections are never instantiated
      // manual and recurring sections are created with the instance
      // (recurring only when the rule matches that day); checkpoint /
      // location / asset sections are created lazily when that thing is
      // actually visited, onto an already-open instance.
      triggerType: i.string(),
      triggerConfig: i.json<Record<string, unknown>>().optional(), // recurring: { recurrenceRule: RRULE }
      hideUntilRule: i.string().optional(), // "HH:MM" — same semantics as the template's
      dueBy: i
        .json<{ kind: "time"; time: string } | { kind: "offset"; minutes: number }>()
        .optional(),
    }),
    checklistTemplateItems: i.entity({
      type: i.string(), // simple_check / verify_task / door_check / gas_pump_check / location_check / meter_reading
      label: i.string(),
      config: i.json<Record<string, unknown>>().optional(),
      order: i.number(),
      // Copy-on-edit: committing an edit writes a NEW row (version+1,
      // previousVersion link) and repoints the section's items link, so
      // instance items forever reference the exact row they were created
      // from without snapshotting config per instance.
      version: i.number(),
    }),
    checklistInstances: i.entity({
      status: i.string().indexed(), // not_started / in_progress / complete
      startedAt: i.date().indexed().optional(),
      completedAt: i.date().indexed().optional(),
      hideUntil: i.date().optional(), // absent or past = visible
      dueBy: i.date().indexed().optional(),
    }),
    checklistInstanceSections: i.entity({
      label: i.string(), // copied from the template section's name at creation
      order: i.number(),
      hideUntil: i.date().optional(),
      dueBy: i.date().optional(),
    }),
    checklistInstanceItems: i.entity({
      order: i.number(), // copied from the template item; user-reorderable afterward
      completedAt: i.date().optional(), // per-item completion time; unset = open
      result: i.json<Record<string, unknown>>().optional(),
      note: i.string().optional(),
    }),

    // ---- incidents, tickets & notes ----
    notes: i.entity({
      body: i.string(),
      createdAt: i.date().indexed(),
    }),
    incidentTypes: i.entity({
      name: i.string(),
    }),
    incidents: i.entity({
      title: i.string(),
      status: i.string().indexed(), // open / under_review / resolved / closed / custom
      customStatus: i.string().optional(),
      details: i.string().optional(), // markdown
      createdAt: i.date().indexed(),
    }),
    incidentComments: i.entity({
      body: i.string(), // markdown
      createdAt: i.date().indexed(),
    }),
    tickets: i.entity({
      title: i.string(),
      description: i.string().optional(), // markdown
      priority: i.string().indexed(), // low / medium / high / urgent
      status: i.string().indexed(), // open / assigned / in_progress / complete (labels admin-adjustable)
      autoGenerated: i.boolean(),
      createdAt: i.date().indexed(),
      resolvedAt: i.date().optional(),
    }),

    // ---- assets ----
    assets: i.entity({
      name: i.string(),
      category: i.string().optional(),
      hasMeter: i.boolean(),
      meterType: i.string().optional(), // mileage / hours
      meterReading: i.number().optional(),
      maintenanceRules: i
        .json<{ kind: "meter" | "time"; every: number; label?: string }[]>()
        .optional(),
      checkoutable: i.boolean(),
      reservationEnabled: i.boolean(),
      reservationVisibility: i.string().optional(), // public / internal
      postReturnStatus: i.string().optional(),
      currentStatus: i.string().optional(), // denormalized latest AssetStatusLog value
    }),
    assetStatusLogs: i.entity({
      status: i.string(),
      note: i.string().optional(),
      timestamp: i.date().indexed(),
    }),
    assetCheckouts: i.entity({
      timeOut: i.date().indexed(),
      timeIn: i.date().optional(), // null while checked out
    }),
    assetMeterReadings: i.entity({
      value: i.number(),
      source: i.string(), // manual / checklist_item
      timestamp: i.date().indexed(),
      correctionReason: i.string().optional(), // required when value < previous reading
    }),

    // ---- reservations ----
    reservations: i.entity({
      status: i.string().indexed(), // requested / confirmed / checked_in / checked_out / cancelled
      // billable / non_billable — chosen per booking; defaults from the
      // target's reservationVisibility. Absent (legacy rows) falls back to
      // that target default too.
      billingType: i.string().optional(),
      expectedCheckin: i.date().indexed().optional(),
      expectedCheckout: i.date().indexed().optional(),
      actualCheckin: i.date().optional(),
      actualCheckout: i.date().optional(),
      // Hidden/ignored when this reservation is non_billable:
      earlyCheckin: i.date().optional(),
      lateCheckout: i.date().optional(),
      rate: i.number().optional(),
      deposit: i.number().optional(),
      balance: i.number().optional(),
    }),

    // ---- boats, owners & leases ----
    contacts: i.entity({
      name: i.string().optional(), // nullable until the nameless-contact prompt fills it
      phone: i.string().indexed().optional(),
      email: i.string().optional(),
    }),
    boats: i.entity({
      name: i.string(),
      description: i.string().optional(),
      length: i.number().optional(),
      make: i.string().optional(),
      model: i.string().optional(),
      registrationNumber: i.string().optional(),
      ownerOrder: i.json<string[]>().optional(), // contact ids, order of succession
    }),
    vehicles: i.entity({
      description: i.string(), // primary label — staff often know a vehicle by sight
      plateNumber: i.string().indexed().optional(),
      ownerOrder: i.json<string[]>().optional(), // contact ids, order of succession
    }),
    leases: i.entity({
      startDate: i.date().indexed().optional(),
      endDate: i.date().indexed().optional(),
      variancesAndConditions: i.string().optional(),
    }),
    leaseComments: i.entity({
      body: i.string(),
      createdAt: i.date().indexed(),
    }),

    // ---- shifts & audit ----
    shifts: i.entity({
      startedAt: i.date().indexed(),
      endedAt: i.date().indexed().optional(),
      reportSentAt: i.date().optional(),
    }),
    activityLogEntries: i.entity({
      eventType: i.string().indexed(), // e.g. "ticket.created"
      summary: i.string(),
      timestamp: i.date().indexed(),
      protected: i.boolean(),
      subjectType: i.string(), // entity name of the record the event happened to
      subjectId: i.string().indexed(),
    }),

    // ---- communications ----
    calls: i.entity({
      direction: i.string(), // inbound / outbound
      line: i.string().optional(),
      fromNumber: i.string().optional(),
      toNumber: i.string().optional(),
      startedAt: i.date().indexed().optional(),
      duration: i.number().optional(),
      recordingUrl: i.string().optional(),
      transcript: i.string().optional(),
      missed: i.boolean().indexed(),
      voicemailUrl: i.string().optional(),
    }),
    callNotes: i.entity({
      body: i.string(),
      createdAt: i.date().indexed(),
    }),
    smsThreads: i.entity({
      line: i.string().optional(),
      lastMessageAt: i.date().indexed().optional(),
      unread: i.boolean().indexed(),
    }),
    smsMessages: i.entity({
      direction: i.string(), // inbound / outbound
      body: i.string(),
      timestamp: i.date().indexed(),
    }),
    smsTemplates: i.entity({
      label: i.string(),
      body: i.string(),
      scope: i.string(), // global / personal
    }),
    chatRooms: i.entity({
      title: i.string(),
      topic: i.string().optional(),
      createdAt: i.date().indexed(),
    }),
    chatMessages: i.entity({
      body: i.string(),
      timestamp: i.date().indexed(),
    }),

    // ---- marina-level configuration (single record) ----
    marinaSettings: i.entity({
      marinaName: i.string().optional(),
      gpsValidationRadiusDefault: i.number(),
      activityLogRetentionDays: i.number(),
      callRecordingEnabled: i.boolean(),
      callTranscriptionEnabled: i.boolean(),
      shiftReportRecipients: i.json<string[]>(),
      phoneLines: i
        .json<{ number: string; label: string; routing?: Record<string, unknown> }[]>()
        .optional(),
      allowOverlappingReservations: i.boolean(),
      // ask / customer — whether hauling a boat out prompts for who did it.
      // A marina haul-out raises a Ticket; a customer one doesn't.
      haulOutMode: i.string().optional(),
    }),
  },

  links: {
    // people & access
    userAuth: {
      forward: { on: "users", has: "one", label: "authUser" },
      reverse: { on: "$users", has: "one", label: "profile" },
    },
    userRoles: {
      forward: { on: "users", has: "many", label: "roles" },
      reverse: { on: "roles", has: "many", label: "users" },
    },
    userContact: {
      forward: { on: "users", has: "one", label: "contact" },
      reverse: { on: "contacts", has: "one", label: "user" },
    },

    // locations & checkpoints
    locationType: {
      forward: { on: "locations", has: "one", label: "type" },
      reverse: { on: "locationTypes", has: "many", label: "locations" },
    },
    locationTypeParents: {
      forward: { on: "locationTypes", has: "many", label: "validParentTypes" },
      reverse: { on: "locationTypes", has: "many", label: "validChildTypes" },
    },
    locationParent: {
      forward: { on: "locations", has: "one", label: "parent" },
      reverse: { on: "locations", has: "many", label: "children" },
    },
    locationCurrentBoat: {
      // Inverse pair from the docs (Location.current_boat / Boat.current_slip) as one link.
      forward: { on: "locations", has: "one", label: "currentBoat" },
      reverse: { on: "boats", has: "one", label: "currentSlip" },
    },
    locationCurrentVehicle: {
      // Mirrors currentBoat for types with hasVehicle (RV sites, parking, mixed-use).
      forward: { on: "locations", has: "one", label: "currentVehicle" },
      reverse: { on: "vehicles", has: "one", label: "currentLocation" },
    },
    marinaMapImage: {
      forward: { on: "marinaMaps", has: "one", label: "image" },
      reverse: { on: "$files", has: "one", label: "marinaMap" },
    },
    marinaMapScope: {
      // Required: every map is scoped to a Location (root Locations carry overview maps).
      forward: { on: "marinaMaps", has: "one", label: "scope" },
      reverse: { on: "locations", has: "many", label: "maps" },
    },
    placementLocation: {
      forward: { on: "locationMapPlacements", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "mapPlacements" },
    },
    placementMap: {
      forward: { on: "locationMapPlacements", has: "one", label: "map" },
      reverse: { on: "marinaMaps", has: "many", label: "placements" },
    },
    checkpointLocation: {
      forward: { on: "checkpoints", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "checkpoints" },
    },
    checkpointTours: {
      forward: { on: "checkpoints", has: "many", label: "tours" },
      reverse: { on: "tours", has: "many", label: "checkpoints" },
    },
    checkInCheckpoint: {
      forward: { on: "checkIns", has: "one", label: "checkpoint" },
      reverse: { on: "checkpoints", has: "many", label: "checkIns" },
    },
    checkInUser: {
      forward: { on: "checkIns", has: "one", label: "user" },
      reverse: { on: "users", has: "many", label: "checkIns" },
    },
    checkInGeneratedChecklist: {
      forward: { on: "checkIns", has: "one", label: "generatedChecklist" },
      reverse: { on: "checklistInstances", has: "one", label: "sourceCheckIn" },
    },

    // checklists
    templateCreator: {
      forward: { on: "checklistTemplates", has: "one", label: "creator" },
      reverse: { on: "users", has: "many", label: "createdChecklistTemplates" },
    },
    templateAssignedRole: {
      // Every template belongs to exactly one role (admin UI enforces it) —
      // that role's members see and work its instances. There is no global
      // or personal visibility anymore.
      forward: { on: "checklistTemplates", has: "one", label: "assignedRole" },
      reverse: { on: "roles", has: "many", label: "checklistTemplates" },
    },
    templateViewerRoles: {
      // Read-only cross-role monitoring: e.g. office watches maintenance's
      // progress without holding the role. Client-side only until the
      // permissions overhaul.
      forward: { on: "checklistTemplates", has: "many", label: "viewerRoles" },
      reverse: { on: "roles", has: "many", label: "viewableChecklistTemplates" },
    },
    templateSections: {
      forward: { on: "checklistTemplateSections", has: "one", label: "template" },
      reverse: { on: "checklistTemplates", has: "many", label: "sections" },
    },
    sectionLocation: {
      // A section sits in at most one location; its checkpoints must belong
      // to that location (admin UI enforces — checkpoints can't move between
      // locations, so this can't drift after authoring).
      forward: { on: "checklistTemplateSections", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "checklistTemplateSections" },
    },
    sectionCheckpointAttachments: {
      forward: { on: "checklistTemplateSections", has: "many", label: "checkpoints" },
      reverse: { on: "checkpoints", has: "many", label: "checklistTemplateSections" },
    },
    sectionAssetAttachments: {
      forward: { on: "checklistTemplateSections", has: "many", label: "assets" },
      reverse: { on: "assets", has: "many", label: "checklistTemplateSections" },
    },
    sectionItems: {
      forward: { on: "checklistTemplateItems", has: "one", label: "section" },
      reverse: { on: "checklistTemplateSections", has: "many", label: "items" },
    },
    itemPreviousVersion: {
      // Copy-on-edit trail. No forward "current" pointer: the live version
      // is whichever row the section's items link points at; older rows are
      // orphaned from the section but keep their instance references.
      forward: { on: "checklistTemplateItems", has: "one", label: "previousVersion" },
      reverse: { on: "checklistTemplateItems", has: "many", label: "laterVersions" },
    },
    instanceTemplate: {
      forward: { on: "checklistInstances", has: "one", label: "template" },
      reverse: { on: "checklistTemplates", has: "many", label: "instances" },
    },
    instanceAssignee: {
      forward: { on: "checklistInstances", has: "one", label: "assignedTo" },
      reverse: { on: "users", has: "many", label: "checklistInstances" },
    },
    instanceSections: {
      forward: { on: "checklistInstanceSections", has: "one", label: "instance" },
      reverse: { on: "checklistInstances", has: "many", label: "sections" },
    },
    instanceSectionTemplate: {
      forward: { on: "checklistInstanceSections", has: "one", label: "template" },
      reverse: { on: "checklistTemplateSections", has: "many", label: "instances" },
    },
    // Location/checkpoint/asset context is copied from the template section
    // at instantiation — the same snapshot idea as item versioning, without
    // needing to version sections.
    instanceSectionLocation: {
      forward: { on: "checklistInstanceSections", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "checklistInstanceSections" },
    },
    instanceSectionCheckpoints: {
      forward: { on: "checklistInstanceSections", has: "many", label: "checkpoints" },
      reverse: { on: "checkpoints", has: "many", label: "checklistInstanceSections" },
    },
    instanceSectionAssets: {
      forward: { on: "checklistInstanceSections", has: "many", label: "assets" },
      reverse: { on: "assets", has: "many", label: "checklistInstanceSections" },
    },
    instanceItemSection: {
      forward: { on: "checklistInstanceItems", has: "one", label: "section" },
      reverse: { on: "checklistInstanceSections", has: "many", label: "items" },
    },
    instanceItemTemplate: {
      // Pins the exact item version this row was created from; label, type,
      // and config are always read through here, never copied.
      forward: { on: "checklistInstanceItems", has: "one", label: "template" },
      reverse: { on: "checklistTemplateItems", has: "many", label: "instances" },
    },
    instanceItemCompletedBy: {
      forward: { on: "checklistInstanceItems", has: "one", label: "completedBy" },
      reverse: { on: "users", has: "many", label: "completedChecklistItems" },
    },
    instanceItemTicket: {
      forward: { on: "checklistInstanceItems", has: "one", label: "linkedTicket" },
      reverse: { on: "tickets", has: "one", label: "sourceChecklistItem" },
    },
    instanceParentItem: {
      // Set only on nested instances spawned by a location_check item.
      // Replaces the old triggeredBy json marker: the checklist list shows
      // instances where this is absent, so sub-checklists don't double-list.
      forward: { on: "checklistInstances", has: "one", label: "parentItem" },
      reverse: { on: "checklistInstanceItems", has: "one", label: "nestedInstance" },
    },

    // notes (attachment target: exactly one of five, app-enforced)
    noteAuthor: {
      forward: { on: "notes", has: "one", label: "author" },
      reverse: { on: "users", has: "many", label: "notes" },
    },
    noteLocation: {
      forward: { on: "notes", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "notes" },
    },
    noteCheckpoint: {
      forward: { on: "notes", has: "one", label: "checkpoint" },
      reverse: { on: "checkpoints", has: "many", label: "notes" },
    },
    noteBoat: {
      forward: { on: "notes", has: "one", label: "boat" },
      reverse: { on: "boats", has: "many", label: "notes" },
    },
    noteContact: {
      forward: { on: "notes", has: "one", label: "contact" },
      reverse: { on: "contacts", has: "many", label: "notes" },
    },
    noteAsset: {
      forward: { on: "notes", has: "one", label: "asset" },
      reverse: { on: "assets", has: "many", label: "notes" },
    },
    noteVehicle: {
      forward: { on: "notes", has: "one", label: "vehicle" },
      reverse: { on: "vehicles", has: "many", label: "notes" },
    },

    // incidents
    incidentType: {
      forward: { on: "incidents", has: "one", label: "type" },
      reverse: { on: "incidentTypes", has: "many", label: "incidents" },
    },
    incidentAuthor: {
      forward: { on: "incidents", has: "one", label: "author" },
      reverse: { on: "users", has: "many", label: "authoredIncidents" },
    },
    incidentAssignee: {
      forward: { on: "incidents", has: "one", label: "assignedTo" },
      reverse: { on: "users", has: "many", label: "assignedIncidents" },
    },
    incidentLocation: {
      forward: { on: "incidents", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "incidents" },
    },
    incidentCheckpoint: {
      forward: { on: "incidents", has: "one", label: "checkpoint" },
      reverse: { on: "checkpoints", has: "many", label: "incidents" },
    },
    incidentBoat: {
      forward: { on: "incidents", has: "one", label: "boat" },
      reverse: { on: "boats", has: "many", label: "incidents" },
    },
    incidentContact: {
      forward: { on: "incidents", has: "one", label: "contact" },
      reverse: { on: "contacts", has: "many", label: "incidents" },
    },
    incidentAsset: {
      forward: { on: "incidents", has: "one", label: "asset" },
      reverse: { on: "assets", has: "many", label: "incidents" },
    },
    incidentVehicle: {
      forward: { on: "incidents", has: "one", label: "vehicle" },
      reverse: { on: "vehicles", has: "many", label: "incidents" },
    },
    incidentCommentIncident: {
      forward: { on: "incidentComments", has: "one", label: "incident" },
      reverse: { on: "incidents", has: "many", label: "comments" },
    },
    incidentCommentAuthor: {
      forward: { on: "incidentComments", has: "one", label: "author" },
      reverse: { on: "users", has: "many", label: "incidentComments" },
    },

    // tickets
    ticketCreator: {
      forward: { on: "tickets", has: "one", label: "createdBy" },
      reverse: { on: "users", has: "many", label: "createdTickets" },
    },
    ticketAssignee: {
      forward: { on: "tickets", has: "one", label: "assignedTo" },
      reverse: { on: "users", has: "many", label: "assignedTickets" },
    },
    ticketSourceIncident: {
      forward: { on: "tickets", has: "one", label: "sourceIncident" },
      reverse: { on: "incidents", has: "many", label: "linkedTickets" },
    },
    ticketLocation: {
      forward: { on: "tickets", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "tickets" },
    },
    ticketCheckpoint: {
      forward: { on: "tickets", has: "one", label: "checkpoint" },
      reverse: { on: "checkpoints", has: "many", label: "tickets" },
    },
    ticketBoat: {
      forward: { on: "tickets", has: "one", label: "boat" },
      reverse: { on: "boats", has: "many", label: "tickets" },
    },
    ticketContact: {
      forward: { on: "tickets", has: "one", label: "contact" },
      reverse: { on: "contacts", has: "many", label: "tickets" },
    },
    ticketAsset: {
      forward: { on: "tickets", has: "one", label: "asset" },
      reverse: { on: "assets", has: "many", label: "tickets" },
    },
    ticketVehicle: {
      forward: { on: "tickets", has: "one", label: "vehicle" },
      reverse: { on: "vehicles", has: "many", label: "tickets" },
    },

    // assets
    statusLogAsset: {
      forward: { on: "assetStatusLogs", has: "one", label: "asset" },
      reverse: { on: "assets", has: "many", label: "statusLog" },
    },
    statusLogUser: {
      forward: { on: "assetStatusLogs", has: "one", label: "loggedBy" },
      reverse: { on: "users", has: "many", label: "assetStatusLogs" },
    },
    checkoutAsset: {
      forward: { on: "assetCheckouts", has: "one", label: "asset" },
      reverse: { on: "assets", has: "many", label: "checkouts" },
    },
    checkoutProcessor: {
      forward: { on: "assetCheckouts", has: "one", label: "checkedOutBy" },
      reverse: { on: "users", has: "many", label: "processedCheckouts" },
    },
    checkoutPerson: {
      forward: { on: "assetCheckouts", has: "one", label: "person" },
      reverse: { on: "contacts", has: "many", label: "assetCheckouts" },
    },
    meterReadingAsset: {
      forward: { on: "assetMeterReadings", has: "one", label: "asset" },
      reverse: { on: "assets", has: "many", label: "meterReadings" },
    },
    meterReadingUser: {
      forward: { on: "assetMeterReadings", has: "one", label: "loggedBy" },
      reverse: { on: "users", has: "many", label: "meterReadings" },
    },
    assetLocation: {
      // Unlike currentBoat/currentVehicle, this isn't exclusive occupancy —
      // a location can hold many assets at once.
      forward: { on: "assets", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "assets" },
    },

    // reservations (target: exactly one of location | asset, app-enforced)
    reservationContact: {
      forward: { on: "reservations", has: "one", label: "contact" },
      reverse: { on: "contacts", has: "many", label: "reservations" },
    },
    reservationLocation: {
      forward: { on: "reservations", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "reservations" },
    },
    reservationAsset: {
      forward: { on: "reservations", has: "one", label: "asset" },
      reverse: { on: "assets", has: "many", label: "reservations" },
    },

    // boats, contacts & leases
    boatOwners: {
      forward: { on: "boats", has: "many", label: "owners" },
      reverse: { on: "contacts", has: "many", label: "ownedBoats" },
    },
    boatAuthorizedUsers: {
      forward: { on: "boats", has: "many", label: "authorizedUsers" },
      reverse: { on: "contacts", has: "many", label: "authorizedBoats" },
    },
    vehicleOwners: {
      forward: { on: "vehicles", has: "many", label: "owners" },
      reverse: { on: "contacts", has: "many", label: "ownedVehicles" },
    },
    contactMergedInto: {
      forward: { on: "contacts", has: "one", label: "mergedInto" },
      reverse: { on: "contacts", has: "many", label: "mergedFrom" },
    },
    leaseLocation: {
      forward: { on: "leases", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "leases" },
    },
    leaseLessees: {
      forward: { on: "leases", has: "many", label: "lessees" },
      reverse: { on: "contacts", has: "many", label: "leases" },
    },
    leaseDocuments: {
      forward: { on: "leases", has: "many", label: "documents" },
      reverse: { on: "$files", has: "one", label: "lease" },
    },
    leaseCommentLease: {
      forward: { on: "leaseComments", has: "one", label: "lease" },
      reverse: { on: "leases", has: "many", label: "comments" },
    },
    leaseCommentAuthor: {
      forward: { on: "leaseComments", has: "one", label: "author" },
      reverse: { on: "users", has: "many", label: "leaseComments" },
    },

    // shifts & audit
    shiftGuard: {
      forward: { on: "shifts", has: "one", label: "guard" },
      reverse: { on: "users", has: "many", label: "shifts" },
    },
    shiftEndChecklist: {
      forward: { on: "shifts", has: "one", label: "endOfShiftChecklist" },
      reverse: { on: "checklistInstances", has: "one", label: "endedShift" },
    },
    activityActor: {
      forward: { on: "activityLogEntries", has: "one", label: "actor" },
      reverse: { on: "users", has: "many", label: "activityLogEntries" },
    },

    // communications
    callContact: {
      forward: { on: "calls", has: "one", label: "contact" },
      reverse: { on: "contacts", has: "many", label: "calls" },
    },
    callNoteCall: {
      forward: { on: "callNotes", has: "one", label: "call" },
      reverse: { on: "calls", has: "many", label: "notes" },
    },
    callNoteAuthor: {
      forward: { on: "callNotes", has: "one", label: "author" },
      reverse: { on: "users", has: "many", label: "callNotes" },
    },
    smsThreadContact: {
      forward: { on: "smsThreads", has: "one", label: "contact" },
      reverse: { on: "contacts", has: "many", label: "smsThreads" },
    },
    smsMessageThread: {
      forward: { on: "smsMessages", has: "one", label: "thread" },
      reverse: { on: "smsThreads", has: "many", label: "messages" },
    },
    smsMessageSender: {
      forward: { on: "smsMessages", has: "one", label: "sentBy" },
      reverse: { on: "users", has: "many", label: "sentSmsMessages" },
    },
    smsTemplateOwner: {
      forward: { on: "smsTemplates", has: "one", label: "owner" },
      reverse: { on: "users", has: "many", label: "smsTemplates" },
    },
    chatRoomCreator: {
      forward: { on: "chatRooms", has: "one", label: "createdBy" },
      reverse: { on: "users", has: "many", label: "createdChatRooms" },
    },
    chatRoomInvitedUsers: {
      forward: { on: "chatRooms", has: "many", label: "invitedUsers" },
      reverse: { on: "users", has: "many", label: "chatRooms" },
    },
    chatRoomInvitedRoles: {
      forward: { on: "chatRooms", has: "many", label: "invitedRoles" },
      reverse: { on: "roles", has: "many", label: "chatRooms" },
    },
    chatMessageRoom: {
      forward: { on: "chatMessages", has: "one", label: "room" },
      reverse: { on: "chatRooms", has: "many", label: "messages" },
    },
    chatMessageAuthor: {
      forward: { on: "chatMessages", has: "one", label: "author" },
      reverse: { on: "users", has: "many", label: "chatMessages" },
    },
    chatMessageAttachments: {
      forward: { on: "chatMessages", has: "many", label: "attachments" },
      reverse: { on: "$files", has: "one", label: "chatMessage" },
    },
  },

  rooms: {},
});

// This helper keeps the schema type from collapsing to a generic `InstantSchemaDef`.
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
