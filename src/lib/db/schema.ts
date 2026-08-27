// GENERATED FILE — do not edit.
//
// Produced by `node scripts/generate-client-schema.mjs` from the local
// Supabase database; `pnpm run schema:check` fails when it drifts. To change
// anything here, write a migration and regenerate.
//
// This is the shape of the device's own SQLite database — the one every query
// in src/data/ runs against, online or off. It is not a description of
// Postgres: booleans are 0/1, timestamps and jsonb and arrays are all text,
// and `id` is implicit on every table because that is how PowerSync keys a
// row. What arrives in these tables is decided by powersync/config/sync-config.yaml,
// not by this file — a table present here with no matching sync stream is
// simply always empty.
import { column, Schema, Table } from "@powersync/web";

const activity_log_entries = new Table(
  {
    event_type: column.text,
    summary: column.text,
    timestamp: column.text,
    protected: column.integer,
    subject_type: column.text,
    subject_id: column.text,
    actor_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_actor_id: ["actor_id"],
    },
  },
);

const asset_checkouts = new Table(
  {
    asset_id: column.text,
    person_id: column.text,
    checked_out_by_id: column.text,
    time_out: column.text,
    time_in: column.text,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_checked_out_by_id: ["checked_out_by_id"],
      by_person_id: ["person_id"],
    },
  },
);

const asset_meter_readings = new Table(
  {
    asset_id: column.text,
    value: column.real,
    source: column.text,
    timestamp: column.text,
    correction_reason: column.text,
    logged_by_id: column.text,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_logged_by_id: ["logged_by_id"],
    },
  },
);

const asset_status_logs = new Table(
  {
    asset_id: column.text,
    status_id: column.text,
    note: column.text,
    timestamp: column.text,
    logged_by_id: column.text,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_logged_by_id: ["logged_by_id"],
      by_status_id: ["status_id"],
    },
  },
);

const asset_statuses = new Table(
  {
    name: column.text,
    position: column.integer,
  },
  {
    indexes: {
      by_name: ["name"],
    },
  },
);

const assets = new Table(
  {
    name: column.text,
    category: column.text,
    location_id: column.text,
    has_meter: column.integer,
    meter_type: column.text,
    meter_reading: column.real,
    checkoutable: column.integer,
    reservation_enabled: column.integer,
    reservation_visibility: column.text,
    post_return_status_id: column.text,
  },
  {
    indexes: {
      by_location_id: ["location_id"],
      by_post_return_status_id: ["post_return_status_id"],
    },
  },
);

const attachments = new Table(
  {
    storage_path: column.text,
    content_type: column.text,
    byte_size: column.integer,
    upload_state: column.text,
    uploaded_by_id: column.text,
    created_at: column.text,
  },
  {
    indexes: {
      by_storage_path: ["storage_path"],
      by_uploaded_by_id: ["uploaded_by_id"],
    },
  },
);

const boat_authorized_users = new Table(
  {
    boat_id: column.text,
    contact_id: column.text,
    is_resident: column.integer,
  },
  {
    indexes: {
      by_boat_id: ["boat_id"],
      by_contact_id: ["contact_id"],
    },
  },
);

const boat_owners = new Table(
  {
    boat_id: column.text,
    contact_id: column.text,
    position: column.integer,
    is_resident: column.integer,
  },
  {
    indexes: {
      by_boat_id: ["boat_id"],
      by_contact_id: ["contact_id"],
    },
  },
);

const boats = new Table(
  {
    name: column.text,
    description: column.text,
    length: column.real,
    make: column.text,
    model: column.text,
    registration_number: column.text,
    is_resident: column.integer,
  },
);

const call_notes = new Table(
  {
    call_id: column.text,
    body: column.text,
    created_at: column.text,
    author_id: column.text,
    required_permission: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_author_id: ["author_id"],
      by_call_id: ["call_id"],
    },
  },
);

const calls = new Table(
  {
    direction: column.text,
    line: column.text,
    from_number: column.text,
    to_number: column.text,
    started_at: column.text,
    duration: column.integer,
    recording_url: column.text,
    transcript: column.text,
    missed: column.integer,
    voicemail_url: column.text,
    contact_id: column.text,
    is_recent: column.integer,
    required_permission: column.text,
  },
  {
    indexes: {
      by_contact_id: ["contact_id"],
    },
  },
);

const chat_message_attachments = new Table(
  {
    message_id: column.text,
    attachment_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_attachment_id: ["attachment_id"],
      by_message_id: ["message_id"],
    },
  },
);

const chat_messages = new Table(
  {
    room_id: column.text,
    author_id: column.text,
    body: column.text,
    timestamp: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_author_id: ["author_id"],
      by_room_id: ["room_id"],
    },
  },
);

const chat_room_roles = new Table(
  {
    room_id: column.text,
    role_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_role_id: ["role_id"],
      by_room_id: ["room_id"],
    },
  },
);

const chat_room_users = new Table(
  {
    room_id: column.text,
    user_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_room_id: ["room_id"],
      by_user_id: ["user_id"],
    },
  },
);

const chat_rooms = new Table(
  {
    title: column.text,
    topic: column.text,
    created_at: column.text,
    created_by_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_created_by_id: ["created_by_id"],
    },
  },
);

const check_ins = new Table(
  {
    checkpoint_id: column.text,
    user_id: column.text,
    timestamp: column.text,
    method: column.text,
    reason: column.text,
    gps_lat: column.real,
    gps_lng: column.real,
    within_radius: column.integer,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_checkpoint_id: ["checkpoint_id"],
      by_user_id: ["user_id"],
    },
  },
);

const checklist_instance_items = new Table(
  {
    section_id: column.text,
    template_item_id: column.text,
    position: column.integer,
    completed_at: column.text,
    completed_by_id: column.text,
    result: column.text,
    note: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_completed_by_id: ["completed_by_id"],
      by_section_id: ["section_id"],
      by_template_item_id: ["template_item_id"],
    },
  },
);

const checklist_instance_sections = new Table(
  {
    instance_id: column.text,
    template_section_id: column.text,
    label: column.text,
    position: column.integer,
    hide_until: column.text,
    due_by: column.text,
    location_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_instance_id: ["instance_id"],
      by_location_id: ["location_id"],
      by_template_section_id: ["template_section_id"],
    },
  },
);

const checklist_instances = new Table(
  {
    template_id: column.text,
    assigned_to_id: column.text,
    status: column.text,
    started_at: column.text,
    completed_at: column.text,
    hide_until: column.text,
    due_by: column.text,
    parent_item_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_assigned_to_id: ["assigned_to_id"],
      by_parent_item_id: ["parent_item_id"],
      by_template_id: ["template_id"],
    },
  },
);

const checklist_template_items = new Table(
  {
    section_id: column.text,
    type: column.text,
    label: column.text,
    config: column.text,
    position: column.integer,
    version: column.integer,
    previous_version_id: column.text,
  },
  {
    indexes: {
      by_previous_version_id: ["previous_version_id"],
      by_section_id: ["section_id"],
    },
  },
);

const checklist_template_sections = new Table(
  {
    template_id: column.text,
    name: column.text,
    position: column.integer,
    is_active: column.integer,
    trigger_type: column.text,
    trigger_config: column.text,
    hide_until_rule: column.text,
    due_by: column.text,
    location_id: column.text,
  },
  {
    indexes: {
      by_location_id: ["location_id"],
      by_template_id: ["template_id"],
    },
  },
);

const checklist_templates = new Table(
  {
    name: column.text,
    trigger_type: column.text,
    trigger_config: column.text,
    assigned_role_id: column.text,
    assigned_to_user: column.integer,
    hide_until_rule: column.text,
    due_by: column.text,
    creator_id: column.text,
  },
  {
    indexes: {
      by_assigned_role_id: ["assigned_role_id"],
      by_creator_id: ["creator_id"],
    },
  },
);

const checkpoints = new Table(
  {
    name: column.text,
    guid_url: column.text,
    location_id: column.text,
    gps_lat: column.real,
    gps_lng: column.real,
    gps_validation_radius: column.integer,
  },
  {
    indexes: {
      by_guid_url: ["guid_url"],
      by_location_id: ["location_id"],
    },
  },
);

const contact_details = new Table(
  {
    contact_id: column.text,
    phone: column.text,
    email: column.text,
    address: column.text,
    required_permission: column.text,
    is_resident: column.integer,
  },
  {
    indexes: {
      by_contact_id: ["contact_id"],
    },
  },
);

const contacts = new Table(
  {
    name: column.text,
    merged_into_id: column.text,
    created_at: column.text,
    is_resident: column.integer,
    required_permission: column.text,
  },
  {
    indexes: {
      by_merged_into_id: ["merged_into_id"],
    },
  },
);

const incident_comments = new Table(
  {
    incident_id: column.text,
    body: column.text,
    created_at: column.text,
    author_id: column.text,
    required_permission: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_author_id: ["author_id"],
      by_incident_id: ["incident_id"],
    },
  },
);

const incident_statuses = new Table(
  {
    name: column.text,
    is_terminal: column.integer,
    position: column.integer,
  },
  {
    indexes: {
      by_name: ["name"],
    },
  },
);

const incident_types = new Table(
  {
    name: column.text,
  },
  {
    indexes: {
      by_name: ["name"],
    },
  },
);

const incidents = new Table(
  {
    title: column.text,
    incident_type_id: column.text,
    status_id: column.text,
    details: column.text,
    created_at: column.text,
    author_id: column.text,
    assigned_to_id: column.text,
    location_id: column.text,
    checkpoint_id: column.text,
    boat_id: column.text,
    vehicle_id: column.text,
    contact_id: column.text,
    asset_id: column.text,
    is_recent: column.integer,
    required_permission: column.text,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_assigned_to_id: ["assigned_to_id"],
      by_author_id: ["author_id"],
      by_boat_id: ["boat_id"],
      by_checkpoint_id: ["checkpoint_id"],
      by_contact_id: ["contact_id"],
      by_incident_type_id: ["incident_type_id"],
      by_location_id: ["location_id"],
      by_status_id: ["status_id"],
      by_vehicle_id: ["vehicle_id"],
    },
  },
);

const lease_comments = new Table(
  {
    lease_id: column.text,
    body: column.text,
    created_at: column.text,
    author_id: column.text,
    required_permission: column.text,
    is_current: column.integer,
  },
  {
    indexes: {
      by_author_id: ["author_id"],
      by_lease_id: ["lease_id"],
    },
  },
);

const lease_documents = new Table(
  {
    lease_id: column.text,
    attachment_id: column.text,
    required_permission: column.text,
    is_current: column.integer,
  },
  {
    indexes: {
      by_attachment_id: ["attachment_id"],
      by_lease_id: ["lease_id"],
    },
  },
);

const lease_lessees = new Table(
  {
    lease_id: column.text,
    contact_id: column.text,
    required_permission: column.text,
    is_current: column.integer,
  },
  {
    indexes: {
      by_contact_id: ["contact_id"],
      by_lease_id: ["lease_id"],
    },
  },
);

const leases = new Table(
  {
    location_id: column.text,
    start_date: column.text,
    end_date: column.text,
    variances_and_conditions: column.text,
    is_current: column.integer,
    required_permission: column.text,
  },
  {
    indexes: {
      by_location_id: ["location_id"],
    },
  },
);

const location_map_placements = new Table(
  {
    map_id: column.text,
    location_id: column.text,
    placement: column.text,
  },
  {
    indexes: {
      by_location_id: ["location_id"],
      by_map_id: ["map_id"],
    },
  },
);

const location_statuses = new Table(
  {
    name: column.text,
    is_vacancy: column.integer,
    position: column.integer,
  },
  {
    indexes: {
      by_name: ["name"],
    },
  },
);

const location_type_parents = new Table(
  {
    parent_type_id: column.text,
    child_type_id: column.text,
  },
  {
    indexes: {
      by_child_type_id: ["child_type_id"],
      by_parent_type_id: ["parent_type_id"],
    },
  },
);

const location_types = new Table(
  {
    name: column.text,
    allows_reservations: column.integer,
    allows_leases: column.integer,
    has_boat: column.integer,
    has_vehicle: column.integer,
    tracks_status: column.integer,
  },
  {
    indexes: {
      by_name: ["name"],
    },
  },
);

const locations = new Table(
  {
    name: column.text,
    location_type_id: column.text,
    parent_id: column.text,
    status_id: column.text,
    post_reservation_status_id: column.text,
    reservation_enabled: column.integer,
    reservation_visibility: column.text,
    lease_enabled: column.integer,
    gps_lat: column.real,
    gps_lng: column.real,
    current_boat_id: column.text,
    current_vehicle_id: column.text,
  },
  {
    indexes: {
      by_current_boat_id: ["current_boat_id"],
      by_current_vehicle_id: ["current_vehicle_id"],
      by_location_type_id: ["location_type_id"],
      by_parent_id: ["parent_id"],
      by_post_reservation_status_id: ["post_reservation_status_id"],
      by_status_id: ["status_id"],
    },
  },
);

const maintenance_rules = new Table(
  {
    asset_id: column.text,
    kind: column.text,
    every: column.real,
    label: column.text,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
    },
  },
);

const marina_maps = new Table(
  {
    name: column.text,
    scope_id: column.text,
    image_attachment_id: column.text,
  },
  {
    indexes: {
      by_image_attachment_id: ["image_attachment_id"],
      by_scope_id: ["scope_id"],
    },
  },
);

const marina_settings = new Table(
  {
    marina_name: column.text,
    gps_validation_radius_default: column.integer,
    activity_log_retention_days: column.integer,
    call_recording_enabled: column.integer,
    call_transcription_enabled: column.integer,
    shift_report_recipients: column.text, // JSON-encoded
    allow_overlapping_reservations: column.integer,
    haul_out_mode: column.text,
  },
);

const notes = new Table(
  {
    body: column.text,
    created_at: column.text,
    author_id: column.text,
    location_id: column.text,
    checkpoint_id: column.text,
    boat_id: column.text,
    vehicle_id: column.text,
    contact_id: column.text,
    asset_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_author_id: ["author_id"],
      by_boat_id: ["boat_id"],
      by_checkpoint_id: ["checkpoint_id"],
      by_contact_id: ["contact_id"],
      by_location_id: ["location_id"],
      by_vehicle_id: ["vehicle_id"],
    },
  },
);

const phone_lines = new Table(
  {
    number: column.text,
    label: column.text,
    routing: column.text,
  },
  {
    indexes: {
      by_number: ["number"],
    },
  },
);

const reservations = new Table(
  {
    status: column.text,
    contact_id: column.text,
    location_id: column.text,
    asset_id: column.text,
    billing_type: column.text,
    expected_checkin: column.text,
    expected_checkout: column.text,
    actual_checkin: column.text,
    actual_checkout: column.text,
    early_checkin: column.text,
    late_checkout: column.text,
    rate: column.real,
    deposit: column.real,
    balance: column.real,
    is_current: column.integer,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_contact_id: ["contact_id"],
      by_location_id: ["location_id"],
    },
  },
);

const roles = new Table(
  {
    name: column.text,
    allow: column.text, // JSON-encoded
    deny: column.text, // JSON-encoded
  },
);

const shifts = new Table(
  {
    guard_id: column.text,
    started_at: column.text,
    ended_at: column.text,
    report_sent_at: column.text,
    end_of_shift_checklist_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_end_of_shift_checklist_id: ["end_of_shift_checklist_id"],
      by_guard_id: ["guard_id"],
    },
  },
);

const sms_messages = new Table(
  {
    thread_id: column.text,
    direction: column.text,
    body: column.text,
    timestamp: column.text,
    sent_by_id: column.text,
    required_permission: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_sent_by_id: ["sent_by_id"],
      by_thread_id: ["thread_id"],
    },
  },
);

const sms_templates = new Table(
  {
    label: column.text,
    body: column.text,
    scope: column.text,
    owner_id: column.text,
  },
  {
    indexes: {
      by_owner_id: ["owner_id"],
    },
  },
);

const sms_threads = new Table(
  {
    line: column.text,
    contact_id: column.text,
    last_message_at: column.text,
    unread: column.integer,
    is_recent: column.integer,
    required_permission: column.text,
  },
  {
    indexes: {
      by_contact_id: ["contact_id"],
    },
  },
);

const template_section_assets = new Table(
  {
    section_id: column.text,
    asset_id: column.text,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_section_id: ["section_id"],
    },
  },
);

const template_section_checkpoints = new Table(
  {
    section_id: column.text,
    checkpoint_id: column.text,
  },
  {
    indexes: {
      by_checkpoint_id: ["checkpoint_id"],
      by_section_id: ["section_id"],
    },
  },
);

const template_viewer_roles = new Table(
  {
    template_id: column.text,
    role_id: column.text,
  },
  {
    indexes: {
      by_role_id: ["role_id"],
      by_template_id: ["template_id"],
    },
  },
);

const ticket_statuses = new Table(
  {
    name: column.text,
    is_terminal: column.integer,
    position: column.integer,
  },
  {
    indexes: {
      by_name: ["name"],
    },
  },
);

const tickets = new Table(
  {
    title: column.text,
    description: column.text,
    priority: column.text,
    status_id: column.text,
    auto_generated: column.integer,
    created_at: column.text,
    resolved_at: column.text,
    created_by_id: column.text,
    assigned_to_id: column.text,
    source_incident_id: column.text,
    source_checklist_item_id: column.text,
    location_id: column.text,
    checkpoint_id: column.text,
    boat_id: column.text,
    vehicle_id: column.text,
    contact_id: column.text,
    asset_id: column.text,
    is_recent: column.integer,
  },
  {
    indexes: {
      by_asset_id: ["asset_id"],
      by_assigned_to_id: ["assigned_to_id"],
      by_boat_id: ["boat_id"],
      by_checkpoint_id: ["checkpoint_id"],
      by_contact_id: ["contact_id"],
      by_created_by_id: ["created_by_id"],
      by_location_id: ["location_id"],
      by_source_checklist_item_id: ["source_checklist_item_id"],
      by_source_incident_id: ["source_incident_id"],
      by_status_id: ["status_id"],
      by_vehicle_id: ["vehicle_id"],
    },
  },
);

const tour_checkpoints = new Table(
  {
    tour_id: column.text,
    checkpoint_id: column.text,
    position: column.integer,
  },
  {
    indexes: {
      by_checkpoint_id: ["checkpoint_id"],
      by_tour_id: ["tour_id"],
    },
  },
);

const tours = new Table(
  {
    name: column.text,
    mode: column.text,
  },
);

const user_permissions = new Table(
  {
    user_id: column.text,
    permission: column.text,
    clerk_user_id: column.text,
  },
  {
    indexes: {
      by_user_id: ["user_id"],
    },
  },
);

const user_roles = new Table(
  {
    user_id: column.text,
    role_id: column.text,
  },
  {
    indexes: {
      by_role_id: ["role_id"],
      by_user_id: ["user_id"],
    },
  },
);

const users = new Table(
  {
    name: column.text,
    email: column.text,
    phone: column.text,
    clerk_user_id: column.text,
    active: column.integer,
    dashboard_layout: column.text,
    created_at: column.text,
    contact_id: column.text,
  },
  {
    indexes: {
      by_clerk_user_id: ["clerk_user_id"],
      by_contact_id: ["contact_id"],
      by_email: ["email"],
    },
  },
);

const vehicle_owners = new Table(
  {
    vehicle_id: column.text,
    contact_id: column.text,
    position: column.integer,
    is_resident: column.integer,
  },
  {
    indexes: {
      by_contact_id: ["contact_id"],
      by_vehicle_id: ["vehicle_id"],
    },
  },
);

const vehicles = new Table(
  {
    description: column.text,
    plate_number: column.text,
    is_resident: column.integer,
  },
);

export const AppSchema = new Schema({
  activity_log_entries,
  asset_checkouts,
  asset_meter_readings,
  asset_status_logs,
  asset_statuses,
  assets,
  attachments,
  boat_authorized_users,
  boat_owners,
  boats,
  call_notes,
  calls,
  chat_message_attachments,
  chat_messages,
  chat_room_roles,
  chat_room_users,
  chat_rooms,
  check_ins,
  checklist_instance_items,
  checklist_instance_sections,
  checklist_instances,
  checklist_template_items,
  checklist_template_sections,
  checklist_templates,
  checkpoints,
  contact_details,
  contacts,
  incident_comments,
  incident_statuses,
  incident_types,
  incidents,
  lease_comments,
  lease_documents,
  lease_lessees,
  leases,
  location_map_placements,
  location_statuses,
  location_type_parents,
  location_types,
  locations,
  maintenance_rules,
  marina_maps,
  marina_settings,
  notes,
  phone_lines,
  reservations,
  roles,
  shifts,
  sms_messages,
  sms_templates,
  sms_threads,
  template_section_assets,
  template_section_checkpoints,
  template_viewer_roles,
  ticket_statuses,
  tickets,
  tour_checkpoints,
  tours,
  user_permissions,
  user_roles,
  users,
  vehicle_owners,
  vehicles,
});

/** Row types for every synced table, keyed by table name. */
export type Database = (typeof AppSchema)["types"];

/** Every table the device can hold, for the upload connector's sanity checks. */
export const TABLE_NAMES = [
  "activity_log_entries",
  "asset_checkouts",
  "asset_meter_readings",
  "asset_status_logs",
  "asset_statuses",
  "assets",
  "attachments",
  "boat_authorized_users",
  "boat_owners",
  "boats",
  "call_notes",
  "calls",
  "chat_message_attachments",
  "chat_messages",
  "chat_room_roles",
  "chat_room_users",
  "chat_rooms",
  "check_ins",
  "checklist_instance_items",
  "checklist_instance_sections",
  "checklist_instances",
  "checklist_template_items",
  "checklist_template_sections",
  "checklist_templates",
  "checkpoints",
  "contact_details",
  "contacts",
  "incident_comments",
  "incident_statuses",
  "incident_types",
  "incidents",
  "lease_comments",
  "lease_documents",
  "lease_lessees",
  "leases",
  "location_map_placements",
  "location_statuses",
  "location_type_parents",
  "location_types",
  "locations",
  "maintenance_rules",
  "marina_maps",
  "marina_settings",
  "notes",
  "phone_lines",
  "reservations",
  "roles",
  "shifts",
  "sms_messages",
  "sms_templates",
  "sms_threads",
  "template_section_assets",
  "template_section_checkpoints",
  "template_viewer_roles",
  "ticket_statuses",
  "tickets",
  "tour_checkpoints",
  "tours",
  "user_permissions",
  "user_roles",
  "users",
  "vehicle_owners",
  "vehicles",
] as const;
