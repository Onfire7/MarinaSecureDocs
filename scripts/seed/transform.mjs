// Instant export -> Postgres rows. PURE: no database, no filesystem.
//
// Kept separate from the load step on purpose (docs/ROADMAP.md): a pure
// transform can be tested against the exported fixture, and extracting a
// per-marina seeder later is refactoring rather than a rewrite.
//
// Input:  { entityName: [row, ...] } exactly as scripts/export-instant.mjs
//         writes it — links are arrays of { id }, even for to-one links.
// Output: { tables: { table_name: [row, ...] }, deferred: [...], dropped: [...] }
//
// `deferred` carries self-referential foreign keys (a location's parent, an
// item's previous version) that cannot be satisfied until every row of that
// table exists. `dropped` records what was deliberately not carried, so the
// loader can report it instead of a row silently vanishing.

import { createHash } from "node:crypto";

// A deterministic UUID from a seed string, so re-running the transform
// produces identical ids and a reload is idempotent. Same idea as
// src/lib/detId.ts, which the app already relies on for converging writes.
export function detUuid(seed) {
  const h = createHash("sha1").update(seed).digest("hex");
  return [
    h.slice(0, 8), h.slice(8, 12),
    "4" + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

const one  = (v) => (Array.isArray(v) && v.length ? v[0].id : null);
const many = (v) => (Array.isArray(v) ? v.map((x) => x.id) : []);
const ts   = (v) => (v == null ? null : new Date(v).toISOString());

// gas_pump_check shipped before Lock Check was generalised past fuel pumps.
// The app maps it on read; nothing reaches Postgres still carrying it.
const LEGACY_ITEM_TYPES = { gas_pump_check: "lock_check" };

const ATTACH = ["location", "checkpoint", "boat", "vehicle", "contact", "asset"];

// `subject_type` names the table a log entry points at, and a CHECK constraint
// (migration 20260826003400) holds it to that list. The InstantDB export
// predates the rule and carries Instant's namespace names for three of them,
// so a fresh database has to be given the normalised value at load time —
// the migration's UPDATEs only ever fixed rows that were already there.
//
// Unknown values throw rather than pass through. A wrong subject_type is not
// a row that fails; it is a row that inserts and then never resolves to a
// subject, which is invisible until someone opens the activity log.
const SUBJECT_TYPES = new Set([
  "assets", "boats", "calls", "check_ins", "checklist_instances", "contacts",
  "incidents", "leases", "locations", "notes", "reservations", "roles",
  "shifts", "sms_threads", "tickets", "users", "vehicles",
]);

// `checklists` joins `checklistInstances` because its entries are all
// checklist.completed against instances that no longer exist — see the
// migration, which reaches the same conclusion at more length.
const SUBJECT_TYPE_ALIASES = {
  checkIns: "check_ins",
  checklistInstances: "checklist_instances",
  checklists: "checklist_instances",
  smsThreads: "sms_threads",
};

function subjectType(raw) {
  const mapped = SUBJECT_TYPE_ALIASES[raw] ?? raw;
  if (!SUBJECT_TYPES.has(mapped)) {
    throw new Error(
      `activityLogEntries.subjectType ${JSON.stringify(raw)} is not a known ` +
      `subject table. Add it to SUBJECT_TYPE_ALIASES if it is an Instant ` +
      `namespace name, or to the CHECK constraint if it is a new subject.`,
    );
  }
  return mapped;
}

export function transform(ex) {
  const g = (n) => ex[n] ?? [];
  const tables = {};
  const deferred = [];
  const dropped = [];
  const put = (t, rows) => { tables[t] = rows; };

  // ── lookups, derived from the distinct values actually present ──────────
  const lookup = (entity, field, table, extra = {}) => {
    const names = [...new Set(g(entity).map((r) => r[field]).filter(Boolean))];
    const byName = new Map();
    put(table, names.map((name, i) => {
      const id = detUuid(`${table}:${name}`);
      byName.set(name, id);
      return { id, name: label(name), position: i, ...extra(name) };
    }));
    return byName;
  };
  const label = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const locStatus = lookup("locations", "status", "location_statuses",
    (n) => ({ is_vacancy: n === "vacant" }));
  const incStatus = lookup("incidents", "status", "incident_statuses",
    (n) => ({ is_terminal: n === "closed" || n === "resolved" }));
  const tktStatus = lookup("tickets", "status", "ticket_statuses",
    (n) => ({ is_terminal: n === "complete" }));
  const assetStatus = lookup("assets", "currentStatus", "asset_statuses", () => ({}));

  put("incident_types", g("incidentTypes").map((r) => ({ id: r.id, name: r.name })));

  put("location_types", g("locationTypes").map((r) => ({
    id: r.id, name: r.name,
    allows_reservations: !!r.allowsReservations,
    allows_leases: !!r.allowsLeases,
    has_boat: !!r.hasBoat, has_vehicle: !!r.hasVehicle,
    tracks_status: !!r.tracksStatus,
  })));
  put("location_type_parents", g("locationTypes").flatMap((r) =>
    many(r.validParentTypes).map((p) => ({ parent_type_id: p, child_type_id: r.id }))));

  // ── attachments (was $files) ────────────────────────────────────────────
  put("attachments", g("$files").map((r) => ({
    id: r.id, storage_path: r.path ?? r.key ?? r.id,
    content_type: r["content-type"] ?? null,
    byte_size: r.size ?? null,
    upload_state: "uploaded", uploaded_by_id: null,
    // created_at omitted deliberately: the column is `not null default now()`
    // and an explicit null overrides the default rather than falling back to
    // it. Instant did not record an upload time, so now() is the honest value.
  })));

  // ── people ──────────────────────────────────────────────────────────────
  put("contacts", g("contacts").map((r) => ({
    id: r.id, name: r.name ?? null, merged_into_id: null,
  })));
  for (const r of g("contacts")) {
    const m = one(r.mergedInto);
    if (m) deferred.push({ table: "contacts", id: r.id, set: { merged_into_id: m } });
  }
  put("contact_details", g("contacts")
    .filter((r) => r.phone || r.email)
    .map((r) => ({ contact_id: r.id, phone: r.phone ?? null, email: r.email ?? null, address: null })));

  put("roles", g("roles").map((r) => ({
    id: r.id, name: r.name, allow: r.allow ?? [], deny: r.deny ?? [],
  })));

  // can_manage_roles / can_manage_users are deliberately not carried: the
  // effective_permissions view computes them.
  put("users", g("users").map((r) => ({
    id: r.id, name: r.name, email: r.email ?? null, phone: r.phone ?? null,
    clerk_user_id: r.clerkUserId ?? null, active: r.active !== false,
    dashboard_layout: r.dashboardLayout ? JSON.stringify(r.dashboardLayout) : null,
    contact_id: one(r.contact),
  })));
  put("user_roles", g("users").flatMap((r) =>
    many(r.roles).map((role_id) => ({ user_id: r.id, role_id }))));

  // ── boats & vehicles (empty in the export; mapped so the shape is proven)
  put("boats", g("boats").map((r) => ({
    id: r.id, name: r.name, description: r.description ?? null,
    length: r.length ?? null, make: r.make ?? null, model: r.model ?? null,
    registration_number: r.registrationNumber ?? null,
  })));
  put("boat_owners", g("boats").flatMap((r) => {
    const order = r.ownerOrder ?? [];
    const ids = many(r.owners);
    const sorted = [...ids].sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
    return sorted.map((contact_id, i) => ({ boat_id: r.id, contact_id, position: i }));
  }));
  put("boat_authorized_users", g("boats").flatMap((r) =>
    many(r.authorizedUsers).map((contact_id) => ({ boat_id: r.id, contact_id }))));
  put("vehicles", g("vehicles").map((r) => ({
    id: r.id, description: r.description, plate_number: r.plateNumber ?? null,
  })));
  put("vehicle_owners", g("vehicles").flatMap((r) => {
    const order = r.ownerOrder ?? [];
    const ids = many(r.owners);
    const sorted = [...ids].sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
    return sorted.map((contact_id, i) => ({ vehicle_id: r.id, contact_id, position: i }));
  }));

  // ── locations ───────────────────────────────────────────────────────────
  put("locations", g("locations").map((r) => ({
    id: r.id, name: r.name,
    location_type_id: one(r.type),
    parent_id: null,
    status_id: r.status ? locStatus.get(r.status) : null,
    post_reservation_status_id: r.postReservationStatus ? locStatus.get(r.postReservationStatus) : null,
    reservation_enabled: !!r.reservationEnabled,
    reservation_visibility: r.reservationVisibility ?? null,
    lease_enabled: !!r.leaseEnabled,
    gps_lat: r.gpsLat ?? null, gps_lng: r.gpsLng ?? null,
    current_boat_id: one(r.currentBoat), current_vehicle_id: one(r.currentVehicle),
  })));
  for (const r of g("locations")) {
    const p = one(r.parent);
    if (p) deferred.push({ table: "locations", id: r.id, set: { parent_id: p } });
  }

  put("marina_maps", g("marinaMaps").map((r) => ({
    id: r.id, name: r.name, scope_id: one(r.scope), image_attachment_id: one(r.image),
  })));
  put("location_map_placements", g("locationMapPlacements").map((r) => ({
    id: r.id, map_id: one(r.map), location_id: one(r.location),
    placement: JSON.stringify(r.placement ?? {}),
  })));

  put("checkpoints", g("checkpoints").map((r) => ({
    id: r.id, name: r.name, guid_url: r.guidUrl,
    location_id: one(r.location),
    gps_lat: r.gpsLat ?? null, gps_lng: r.gpsLng ?? null,
    gps_validation_radius: r.gpsValidationRadius ?? null,
  })));

  put("tours", g("tours").map((r) => ({ id: r.id, name: r.name, mode: r.mode ?? "freeform" })));
  put("tour_checkpoints", g("tours").flatMap((r) => {
    const order = r.checkpointOrder ?? [];
    const ids = many(r.checkpoints);
    const sorted = [...ids].sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
    return sorted.map((checkpoint_id, i) => ({ tour_id: r.id, checkpoint_id, position: i }));
  }));

  // ── assets ──────────────────────────────────────────────────────────────
  // current_status is NOT carried: it denormalised the newest status log, and
  // the device now derives it. See docs/data-model.md.
  put("assets", g("assets").map((r) => ({
    id: r.id, name: r.name, category: r.category ?? null,
    location_id: one(r.location),
    has_meter: !!r.hasMeter, meter_type: r.meterType ?? null,
    meter_reading: r.meterReading ?? null,
    checkoutable: !!r.checkoutable,
    reservation_enabled: !!r.reservationEnabled,
    reservation_visibility: r.reservationVisibility ?? null,
    post_return_status_id: r.postReturnStatus ? assetStatus.get(r.postReturnStatus) : null,
  })));
  put("maintenance_rules", g("assets").flatMap((r) =>
    (r.maintenanceRules ?? []).map((rule, i) => ({
      id: detUuid(`maintenance_rule:${r.id}:${i}`),
      asset_id: r.id, kind: rule.kind, every: rule.every, label: rule.label ?? null,
    }))));
  put("asset_status_logs", g("assetStatusLogs").map((r) => ({
    id: r.id, asset_id: one(r.asset),
    status_id: r.status ? assetStatus.get(r.status) : null,
    note: r.note ?? null, timestamp: ts(r.timestamp), logged_by_id: one(r.loggedBy),
  })));
  put("asset_checkouts", g("assetCheckouts").map((r) => ({
    id: r.id, asset_id: one(r.asset), person_id: one(r.person),
    checked_out_by_id: one(r.checkedOutBy), time_out: ts(r.timeOut), time_in: ts(r.timeIn),
  })));
  put("asset_meter_readings", g("assetMeterReadings").map((r) => ({
    id: r.id, asset_id: one(r.asset), value: r.value, source: r.source,
    timestamp: ts(r.timestamp), correction_reason: r.correctionReason ?? null,
    logged_by_id: one(r.loggedBy),
  })));

  // ── leases & reservations ───────────────────────────────────────────────
  put("leases", g("leases").map((r) => ({
    id: r.id, location_id: one(r.location),
    start_date: ts(r.startDate), end_date: ts(r.endDate),
    variances_and_conditions: r.variancesAndConditions ?? null,
  })));
  put("lease_lessees", g("leases").flatMap((r) =>
    many(r.lessees).map((contact_id) => ({ lease_id: r.id, contact_id }))));
  put("lease_documents", g("leases").flatMap((r) =>
    many(r.documents).map((attachment_id) => ({ lease_id: r.id, attachment_id }))));
  put("lease_comments", g("leaseComments").map((r) => ({
    id: r.id, lease_id: one(r.lease), body: r.body,
    created_at: ts(r.createdAt), author_id: one(r.author),
  })));

  put("reservations", g("reservations").map((r) => ({
    id: r.id, status: r.status, contact_id: one(r.contact),
    location_id: one(r.location), asset_id: one(r.asset),
    billing_type: r.billingType ?? null,
    expected_checkin: ts(r.expectedCheckin), expected_checkout: ts(r.expectedCheckout),
    actual_checkin: ts(r.actualCheckin), actual_checkout: ts(r.actualCheckout),
    early_checkin: ts(r.earlyCheckin), late_checkout: ts(r.lateCheckout),
    rate: r.rate ?? null, deposit: r.deposit ?? null, balance: r.balance ?? null,
  })));

  // ── checklists ──────────────────────────────────────────────────────────
  put("checklist_templates", g("checklistTemplates").map((r) => ({
    id: r.id, name: r.name, trigger_type: r.triggerType,
    trigger_config: r.triggerConfig ? JSON.stringify(r.triggerConfig) : null,
    assigned_role_id: one(r.assignedRole),
    assigned_to_user: !!r.assignedToUser,
    hide_until_rule: r.hideUntilRule ?? null,
    due_by: r.dueBy ? JSON.stringify(r.dueBy) : null,
    creator_id: one(r.creator),
  })));
  put("template_viewer_roles", g("checklistTemplates").flatMap((r) =>
    many(r.viewerRoles).map((role_id) => ({ template_id: r.id, role_id }))));
  put("checklist_template_sections", g("checklistTemplateSections").map((r) => ({
    id: r.id, template_id: one(r.template), name: r.name,
    position: r.order ?? 0, is_active: r.isActive !== false,
    trigger_type: r.triggerType ?? "manual",
    trigger_config: r.triggerConfig ? JSON.stringify(r.triggerConfig) : null,
    hide_until_rule: r.hideUntilRule ?? null,
    due_by: r.dueBy ? JSON.stringify(r.dueBy) : null,
    location_id: one(r.location),
  })));
  put("template_section_checkpoints", g("checklistTemplateSections").flatMap((r) =>
    many(r.checkpoints).map((checkpoint_id) => ({ section_id: r.id, checkpoint_id }))));
  put("template_section_assets", g("checklistTemplateSections").flatMap((r) =>
    many(r.assets).map((asset_id) => ({ section_id: r.id, asset_id }))));
  put("checklist_template_items", g("checklistTemplateItems").map((r) => ({
    id: r.id, section_id: one(r.section),
    type: LEGACY_ITEM_TYPES[r.type] ?? r.type,
    label: r.label, config: r.config ? JSON.stringify(r.config) : null,
    position: r.order ?? 0, version: r.version ?? 1, previous_version_id: null,
  })));
  for (const r of g("checklistTemplateItems")) {
    const p = one(r.previousVersion);
    if (p) deferred.push({ table: "checklist_template_items", id: r.id, set: { previous_version_id: p } });
  }

  put("checklist_instances", g("checklistInstances").map((r) => ({
    id: r.id, template_id: one(r.template), assigned_to_id: one(r.assignedTo),
    status: r.status, started_at: ts(r.startedAt), completed_at: ts(r.completedAt),
    hide_until: ts(r.hideUntil), due_by: ts(r.dueBy), parent_item_id: null,
  })));
  put("checklist_instance_sections", g("checklistInstanceSections").map((r) => ({
    id: r.id, instance_id: one(r.instance), template_section_id: one(r.template),
    label: r.label, position: r.order ?? 0,
    hide_until: ts(r.hideUntil), due_by: ts(r.dueBy), location_id: one(r.location),
  })));
  put("checklist_instance_items", g("checklistInstanceItems").map((r) => ({
    id: r.id, section_id: one(r.section), template_item_id: one(r.template),
    position: r.order ?? 0, completed_at: ts(r.completedAt),
    completed_by_id: one(r.completedBy),
    result: r.result ? JSON.stringify(r.result) : null, note: r.note ?? null,
  })));
  for (const r of g("checklistInstances")) {
    const p = one(r.parentItem);
    if (p) deferred.push({ table: "checklist_instances", id: r.id, set: { parent_item_id: p } });
  }

  put("check_ins", g("checkIns").map((r) => ({
    id: r.id, checkpoint_id: one(r.checkpoint), user_id: one(r.user),
    timestamp: ts(r.timestamp), method: r.method,
    // The database enforces what the app only asserted: a manual check-in
    // must say why. Legacy rows without one get an explicit marker rather
    // than being dropped.
    reason: r.method === "manual" ? (r.reason ?? "(not recorded)") : (r.reason ?? null),
    gps_lat: r.gpsLat ?? null, gps_lng: r.gpsLng ?? null,
    within_radius: r.withinRadius ?? null,
  })));

  // ── attachable entities ─────────────────────────────────────────────────
  const attachCols = (r) => Object.fromEntries(ATTACH.map((k) => [`${k}_id`, one(r[k])]));
  const targetCount = (r) => ATTACH.filter((k) => one(r[k])).length;

  const carry = (entity, table, build) => {
    const kept = [];
    for (const r of g(entity)) {
      if (targetCount(r) !== 1) {
        dropped.push({ table, id: r.id, title: r.title ?? r.body?.slice(0, 60) ?? "(untitled)",
                       reason: `${targetCount(r)} attachment targets; the schema requires exactly 1` });
        continue;
      }
      kept.push(build(r));
    }
    put(table, kept);
  };

  carry("notes", "notes", (r) => ({
    id: r.id, body: r.body, created_at: ts(r.createdAt), author_id: one(r.author),
    ...attachCols(r),
  }));
  carry("incidents", "incidents", (r) => ({
    id: r.id, title: r.title, incident_type_id: one(r.type),
    status_id: incStatus.get(r.status), details: r.details ?? null,
    created_at: ts(r.createdAt), author_id: one(r.author), assigned_to_id: one(r.assignedTo),
    ...attachCols(r),
  }));
  put("incident_comments", g("incidentComments").map((r) => ({
    id: r.id, incident_id: one(r.incident), body: r.body,
    created_at: ts(r.createdAt), author_id: one(r.author),
  })));
  carry("tickets", "tickets", (r) => ({
    id: r.id, title: r.title, description: r.description ?? null,
    priority: r.priority ?? "medium", status_id: tktStatus.get(r.status),
    auto_generated: !!r.autoGenerated,
    created_at: ts(r.createdAt), resolved_at: ts(r.resolvedAt),
    created_by_id: one(r.createdBy), assigned_to_id: one(r.assignedTo),
    source_incident_id: one(r.sourceIncident),
    source_checklist_item_id: one(r.sourceChecklistItem),
    ...attachCols(r),
  }));

  // ── shifts & audit ──────────────────────────────────────────────────────
  put("shifts", g("shifts").map((r) => ({
    id: r.id, guard_id: one(r.guard), started_at: ts(r.startedAt),
    ended_at: ts(r.endedAt), report_sent_at: ts(r.reportSentAt),
    end_of_shift_checklist_id: one(r.endOfShiftChecklist),
  })));
  put("activity_log_entries", g("activityLogEntries").map((r) => ({
    id: r.id, event_type: r.eventType, summary: r.summary,
    timestamp: ts(r.timestamp), protected: !!r.protected,
    subject_type: subjectType(r.subjectType), subject_id: r.subjectId,
    actor_id: one(r.actor),
  })));

  // ── comms ───────────────────────────────────────────────────────────────
  put("calls", g("calls").map((r) => ({
    id: r.id, direction: r.direction, line: r.line ?? null,
    from_number: r.fromNumber ?? null, to_number: r.toNumber ?? null,
    started_at: ts(r.startedAt), duration: r.duration ?? null,
    recording_url: r.recordingUrl ?? null, transcript: r.transcript ?? null,
    missed: !!r.missed, voicemail_url: r.voicemailUrl ?? null, contact_id: one(r.contact),
  })));
  put("call_notes", g("callNotes").map((r) => ({
    id: r.id, call_id: one(r.call), body: r.body,
    created_at: ts(r.createdAt), author_id: one(r.author),
  })));
  put("sms_threads", g("smsThreads").map((r) => ({
    id: r.id, line: r.line ?? null, contact_id: one(r.contact),
    last_message_at: ts(r.lastMessageAt), unread: !!r.unread,
  })));
  put("sms_messages", g("smsMessages").map((r) => ({
    id: r.id, thread_id: one(r.thread), direction: r.direction, body: r.body,
    timestamp: ts(r.timestamp), sent_by_id: one(r.sentBy),
  })));
  put("sms_templates", g("smsTemplates").map((r) => ({
    id: r.id, label: r.label, body: r.body, scope: r.scope ?? "global", owner_id: one(r.owner),
  })));
  put("chat_rooms", g("chatRooms").map((r) => ({
    id: r.id, title: r.title, topic: r.topic ?? null,
    created_at: ts(r.createdAt), created_by_id: one(r.createdBy),
  })));
  put("chat_room_users", g("chatRooms").flatMap((r) =>
    many(r.invitedUsers).map((user_id) => ({ room_id: r.id, user_id }))));
  put("chat_room_roles", g("chatRooms").flatMap((r) =>
    many(r.invitedRoles).map((role_id) => ({ room_id: r.id, role_id }))));
  put("chat_messages", g("chatMessages").map((r) => ({
    id: r.id, room_id: one(r.room), author_id: one(r.author),
    body: r.body, timestamp: ts(r.timestamp),
  })));
  put("chat_message_attachments", g("chatMessages").flatMap((r) =>
    many(r.attachments).map((attachment_id) => ({ message_id: r.id, attachment_id }))));

  // ── settings ────────────────────────────────────────────────────────────
  put("marina_settings", g("marinaSettings").slice(0, 1).map((r) => ({
    id: 1, marina_name: r.marinaName ?? null,
    gps_validation_radius_default: r.gpsValidationRadiusDefault ?? 50,
    activity_log_retention_days: r.activityLogRetentionDays ?? 365,
    call_recording_enabled: !!r.callRecordingEnabled,
    call_transcription_enabled: !!r.callTranscriptionEnabled,
    shift_report_recipients: r.shiftReportRecipients ?? [],
    allow_overlapping_reservations: !!r.allowOverlappingReservations,
    haul_out_mode: r.haulOutMode ?? "ask",
  })));
  put("phone_lines", (g("marinaSettings")[0]?.phoneLines ?? []).map((l, i) => ({
    id: detUuid(`phone_line:${i}:${l.number}`),
    number: l.number, label: l.label, routing: l.routing ? JSON.stringify(l.routing) : null,
  })));

  return { tables, deferred, dropped };
}

// FK-safe insert order. Self-references are handled by `deferred`.
export const LOAD_ORDER = [
  "location_statuses", "incident_statuses", "ticket_statuses", "asset_statuses",
  "incident_types", "location_types", "location_type_parents",
  "attachments", "contacts", "contact_details", "roles", "users", "user_roles",
  "boats", "boat_owners", "boat_authorized_users",
  "vehicles", "vehicle_owners",
  "locations", "marina_maps", "location_map_placements",
  "checkpoints", "tours", "tour_checkpoints",
  "assets", "maintenance_rules", "asset_status_logs", "asset_checkouts", "asset_meter_readings",
  "leases", "lease_lessees", "lease_documents", "lease_comments", "reservations",
  "checklist_templates", "template_viewer_roles", "checklist_template_sections",
  "template_section_checkpoints", "template_section_assets", "checklist_template_items",
  "checklist_instances", "checklist_instance_sections", "checklist_instance_items",
  "check_ins", "notes", "incidents", "incident_comments", "tickets",
  "shifts", "activity_log_entries",
  "calls", "call_notes", "sms_threads", "sms_messages", "sms_templates",
  "chat_rooms", "chat_room_users", "chat_room_roles", "chat_messages", "chat_message_attachments",
  "marina_settings", "phone_lines",
];
