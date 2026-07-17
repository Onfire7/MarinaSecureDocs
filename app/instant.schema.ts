// MarinaSecure — InstantDB schema.
// Mirrors the entities in docs/data-model.html (main branch: data-model.html).
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
    }),
    roles: i.entity({
      name: i.string(),
      // Map of permission key → "allow" | "deny"; absent key = undefined (no opinion).
      permissions: i.json<Record<string, "allow" | "deny">>(),
    }),

    // ---- locations & checkpoints ----
    locationTypes: i.entity({
      name: i.string(),
      allowsReservations: i.boolean(),
    }),
    locations: i.entity({
      name: i.string(),
      status: i.string(), // occupied / vacant / reserved / out_of_service / admin-defined
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
      rect: i.json<{ x: number; y: number; width: number; height: number }>(),
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
    checklistTemplates: i.entity({
      name: i.string(),
      visibility: i.string(), // global / role_restricted / personal
      triggerType: i.string().indexed(), // clock_in / clock_out / scheduled / checkpoint / incident_type / manual
      triggerConfig: i.json<Record<string, unknown>>().optional(),
      assignmentMode: i.string(), // triggering_user / role
    }),
    checklistTemplateItems: i.entity({
      type: i.string(), // simple_check / verify_task / door_check / location_check / meter_reading
      label: i.string(),
      config: i.json<Record<string, unknown>>().optional(),
      order: i.number(),
    }),
    checklists: i.entity({
      status: i.string().indexed(), // not_started / in_progress / complete
      triggeredBy: i.json<Record<string, unknown>>().optional(),
      startedAt: i.date().indexed().optional(),
      completedAt: i.date().indexed().optional(),
    }),
    checklistItemResults: i.entity({
      result: i.json<Record<string, unknown>>().optional(),
      note: i.string().optional(),
      completedAt: i.date().optional(),
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
      expectedCheckin: i.date().indexed().optional(),
      expectedCheckout: i.date().indexed().optional(),
      actualCheckin: i.date().optional(),
      actualCheckout: i.date().optional(),
      // Hidden/ignored when the target's reservationVisibility is internal:
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
    checkpointTemplates: {
      forward: { on: "checkpoints", has: "many", label: "checklistTemplates" },
      reverse: { on: "checklistTemplates", has: "many", label: "checkpoints" },
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
      reverse: { on: "checklists", has: "one", label: "sourceCheckIn" },
    },

    // checklists
    templateCreator: {
      forward: { on: "checklistTemplates", has: "one", label: "creator" },
      reverse: { on: "users", has: "many", label: "createdChecklistTemplates" },
    },
    templateRole: {
      // Role restriction (visibility) and/or role assignment target.
      forward: { on: "checklistTemplates", has: "one", label: "role" },
      reverse: { on: "roles", has: "many", label: "checklistTemplates" },
    },
    templateItems: {
      forward: { on: "checklistTemplateItems", has: "one", label: "template" },
      reverse: { on: "checklistTemplates", has: "many", label: "items" },
    },
    checklistTemplate: {
      forward: { on: "checklists", has: "one", label: "template" },
      reverse: { on: "checklistTemplates", has: "many", label: "instances" },
    },
    checklistAssignee: {
      forward: { on: "checklists", has: "one", label: "assignedTo" },
      reverse: { on: "users", has: "many", label: "checklists" },
    },
    itemResultChecklist: {
      forward: { on: "checklistItemResults", has: "one", label: "checklist" },
      reverse: { on: "checklists", has: "many", label: "itemResults" },
    },
    itemResultTemplateItem: {
      forward: { on: "checklistItemResults", has: "one", label: "templateItem" },
      reverse: { on: "checklistTemplateItems", has: "many", label: "results" },
    },
    itemResultTicket: {
      forward: { on: "checklistItemResults", has: "one", label: "linkedTicket" },
      reverse: { on: "tickets", has: "one", label: "sourceChecklistItem" },
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
      reverse: { on: "checklists", has: "one", label: "endedShift" },
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
