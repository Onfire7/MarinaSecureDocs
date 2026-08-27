import { useQuery } from "@powersync/react";
import { db, bool, json, jsonArray } from "../lib/db";
import { update } from "./sql";

// Marina settings — one row, per marina, always resident.
//
// It is a singleton with an integer id rather than a uuid, which is the one
// place this schema deviates: there is no second marina in this database, ever
// (each marina is its own deployment), so a generated key would be pretending.

export interface MarinaSettingsRow {
  id: string;
  marina_name: string | null;
  gps_validation_radius_default: number | null;
  activity_log_retention_days: number | null;
  call_recording_enabled: number;
  call_transcription_enabled: number;
  shift_report_recipients: string | null;
  allow_overlapping_reservations: number;
  haul_out_mode: string | null;
}

export interface MarinaSettings {
  id: string;
  marinaName: string;
  gpsValidationRadiusDefault: number;
  activityLogRetentionDays: number;
  callRecordingEnabled: boolean;
  callTranscriptionEnabled: boolean;
  shiftReportRecipients: string[];
  allowOverlappingReservations: boolean;
  haulOutMode: string;
}

const DEFAULTS: Omit<MarinaSettings, "id"> = {
  marinaName: "Marina",
  gpsValidationRadiusDefault: 50,
  activityLogRetentionDays: 30,
  callRecordingEnabled: false,
  callTranscriptionEnabled: false,
  shiftReportRecipients: [],
  allowOverlappingReservations: false,
  haulOutMode: "off",
};

function toSettings(row: MarinaSettingsRow | undefined): MarinaSettings {
  if (!row) return { id: "1", ...DEFAULTS };
  return {
    id: row.id,
    marinaName: row.marina_name ?? DEFAULTS.marinaName,
    gpsValidationRadiusDefault:
      row.gps_validation_radius_default ?? DEFAULTS.gpsValidationRadiusDefault,
    activityLogRetentionDays:
      row.activity_log_retention_days ?? DEFAULTS.activityLogRetentionDays,
    callRecordingEnabled: bool(row.call_recording_enabled),
    callTranscriptionEnabled: bool(row.call_transcription_enabled),
    shiftReportRecipients: jsonArray(row.shift_report_recipients),
    allowOverlappingReservations: bool(row.allow_overlapping_reservations),
    haulOutMode: row.haul_out_mode ?? DEFAULTS.haulOutMode,
  };
}

/**
 * The marina's settings, with defaults where the row has not synced yet.
 *
 * Defaults rather than null because this is read on the sign-in screen, before
 * any sync has happened on a new device. "Marina" on a first launch is better
 * than a blank header, and every consumer would otherwise write the same
 * fallback.
 */
export function useMarinaSettings(): MarinaSettings {
  const { data } = useQuery<MarinaSettingsRow>(
    "SELECT * FROM marina_settings LIMIT 1",
  );
  return toSettings(data[0]);
}

export function useMarinaName(): string {
  return useMarinaSettings().marinaName;
}

export async function saveMarinaSettings(
  id: string,
  changes: Partial<{
    marinaName: string;
    gpsValidationRadiusDefault: number;
    activityLogRetentionDays: number;
    callRecordingEnabled: boolean;
    callTranscriptionEnabled: boolean;
    shiftReportRecipients: string[];
    allowOverlappingReservations: boolean;
    haulOutMode: string;
  }>,
): Promise<void> {
  await update(db, "marina_settings", id, {
    marina_name: changes.marinaName,
    gps_validation_radius_default: changes.gpsValidationRadiusDefault,
    activity_log_retention_days: changes.activityLogRetentionDays,
    call_recording_enabled:
      changes.callRecordingEnabled === undefined
        ? undefined
        : changes.callRecordingEnabled
          ? 1
          : 0,
    call_transcription_enabled:
      changes.callTranscriptionEnabled === undefined
        ? undefined
        : changes.callTranscriptionEnabled
          ? 1
          : 0,
    shift_report_recipients:
      changes.shiftReportRecipients === undefined
        ? undefined
        : JSON.stringify(changes.shiftReportRecipients),
    allow_overlapping_reservations:
      changes.allowOverlappingReservations === undefined
        ? undefined
        : changes.allowOverlappingReservations
          ? 1
          : 0,
    haul_out_mode: changes.haulOutMode,
  });
}

export interface PhoneLineRow {
  id: string;
  number: string;
  label: string;
  routing: string | null;
}

export function usePhoneLines() {
  const { data, isLoading } = useQuery<PhoneLineRow>(
    "SELECT * FROM phone_lines ORDER BY label",
  );
  return {
    isLoading,
    lines: data.map((l) => ({
      id: l.id,
      number: l.number,
      label: l.label,
      routing: json<Record<string, unknown>>(l.routing, {}),
    })),
  };
}
