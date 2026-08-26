-- Closed enumerations only.
--
-- A value belongs here when the *code* decides the set — call direction,
-- check-in method. Sets an ADMIN extends at runtime (location status, incident
-- status, ticket status) are lookup TABLES instead, because a Postgres enum
-- cannot be extended without a migration. See docs/data-model.md.

create type visibility          as enum ('public', 'internal');
create type tour_mode           as enum ('linear', 'freeform', 'randomized');
create type checkin_method      as enum ('scanned', 'manual');
create type ticket_priority     as enum ('low', 'medium', 'high', 'urgent');
create type reservation_status  as enum ('requested','confirmed','checked_in','checked_out','cancelled');
create type billing_type        as enum ('billable', 'non_billable');
create type meter_type          as enum ('mileage', 'hours');
create type meter_source        as enum ('manual', 'checklist_item');
create type checklist_status    as enum ('not_started', 'in_progress', 'complete');
create type template_trigger    as enum ('manual','clock_in','clock_out','checkpoint','recurring');
create type section_trigger     as enum ('manual','recurring','checkpoint','location','asset','location_status');
create type checklist_item_type as enum ('simple_check','verify_task','door_check','gas_pump_check','location_check','meter_reading');
create type comms_direction     as enum ('inbound', 'outbound');
create type template_scope      as enum ('global', 'personal');
create type upload_state        as enum ('pending', 'uploaded');
create type haul_out_mode       as enum ('ask', 'customer');
create type maintenance_kind    as enum ('meter', 'time');
