// Shared core of the two ways a checkpoint visit is logged — the scanned
// NFC/QR deep link (CheckpointCheckinPage) and the Manual Check-In dialog —
// per pages/checkpoint-checkin.html and pages/manual-checkin-dialog.html:
// create-or-resume the check-in record, materialize whatever the scan
// triggers, and capture GPS in the background without blocking either flow.
//
// What a scan triggers, in the sectioned model:
//  - checklist *sections* anchored to this checkpoint (or its location) on
//    already-open instances get created now, if they don't exist yet;
//  - checkpoint-triggered *templates* with a section here and no open
//    instance get a whole new instance;
//  - and the visit screen displays every open instance section for this
//    place, headed by its parent checklist's name.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { deterministicId } from "../../lib/detId";
import { distanceMeters } from "../../lib/geo";
import { eligibleToday, isVisibleNow } from "../../lib/checklists";
import { db, id, stamp } from "../../lib/db";
import { insert, transact, update } from "../../data/sql";
import { recordActivity } from "../../data/activity";
import {
  insertInstance,
  insertSectionInstance,
  sectionInstanceId,
} from "../../data/checklistInstantiation";
import {
  useSectionsAnchoredAt,
  useSectionsAtCheckpoint,
} from "../../data/checklists";
import { useCheckpoint } from "../../data/checkpoints";
import { useMarinaSettings } from "../../data/settings";
import { useRecentCheckIns, type CheckInRow } from "../../data/checkins";

const DEDUPE_WINDOW_MS = 5 * 60_000;
const GPS_TIMEOUT_MS = 20_000;

export type GpsStatus = "pending" | "clear" | "outside_radius" | "unavailable";

export interface ApplicableSection {
  id: string;
  label: string;
  instanceId: string;
  checklistName: string;
  itemsTotal: number;
  itemsDone: number;
  complete: boolean;
}

export function useCheckpointVisit(
  checkpointId: string | undefined,
  method: "scanned" | "manual",
  reason: string | undefined,
  resumeCheckInId: string | undefined,
) {
  const current = useCurrent();
  const userId = current.user?.id;

  const { checkpoint, isLoading: cpLoading } = useCheckpoint(checkpointId);
  const settings = useMarinaSettings();
  const locationId = checkpoint?.location_id ?? undefined;

  // Everything this scan could show or create. Two queries rather than one:
  // what is already materialized here, and what is anchored here and would be.
  const { data: sectionsHere, isLoading: secLoading } = useSectionsAtCheckpoint(
    checkpointId,
    locationId,
  );
  const anchored = useSectionsAnchoredAt(checkpointId, locationId);

  // The dedupe cutoff is pinned to when this visit mounted rather than
  // recomputed per render. A watched query whose parameters differ every render
  // — and `Date.now()` differs every millisecond — resubscribes every render,
  // pushes a fresh snapshot, and re-renders: an infinite loop React aborts with
  // "Maximum update depth exceeded". A cutoff drifting by milliseconds bought
  // nothing anyway against a five-minute window.
  const [dedupeSince] = useState(() =>
    new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString(),
  );

  // Dedupe exists because the scanned screen is reached by re-opening a URL
  // (reload, resumed tab). The manual dialog is opened from inside a running
  // session and closes on submit, so it needs no dedupe — and applying it would
  // silently swallow a legitimate second manual check-in at the same
  // checkpoint, per the Manual Check-In spec.
  const { data: recent, isLoading: recentLoading } = useRecentCheckIns(
    method === "scanned" && !resumeCheckInId ? checkpointId : undefined,
    5,
  );
  const dedupeCandidate = recent.find(
    (c) => c.user_id === userId && c.timestamp > dedupeSince,
  );

  const [resumed, setResumed] = useState<CheckInRow | null>(null);
  const [resumedLoading, setResumedLoading] = useState(Boolean(resumeCheckInId));
  useEffect(() => {
    if (!resumeCheckInId) return;
    let cancelled = false;
    void db
      .getOptional<CheckInRow>("SELECT * FROM check_ins WHERE id = ?", [
        resumeCheckInId,
      ])
      .then((row) => {
        if (!cancelled) {
          setResumed(row);
          setResumedLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resumeCheckInId]);

  const existingCheckIn = resumed ?? dedupeCandidate ?? null;
  const dedupeSettled =
    method === "manual" ? true : resumeCheckInId ? !resumedLoading : !recentLoading;

  const [createdCheckInId, setCreatedCheckInId] = useState<string | null>(null);
  const creating = useRef(false);

  // Create the check-in — and materialize what the scan triggers — exactly once
  // per fresh visit; if an existing check-in resolves via URL or dedupe first,
  // this never fires, because that scan already materialized these rows.
  useEffect(() => {
    if (!checkpoint || !userId || !dedupeSettled || secLoading) return;
    if (existingCheckIn || createdCheckInId || creating.current) return;
    if (method === "manual" && !reason) return;
    creating.current = true;

    const checkInId = id();
    const now = new Date();
    const existingSectionIds = new Set(sectionsHere.map((s) => s.id));

    // Group by template: a template with an open instance gets its missing
    // sections added to that instance; one without gets a whole new checklist,
    // but only if the TEMPLATE itself is checkpoint-triggered. A location
    // section on a manual template waits for someone to start the checklist.
    const byTemplate = new Map<string, typeof anchored>();
    for (const a of anchored) {
      const list = byTemplate.get(a.template.id) ?? [];
      list.push(a);
      byTemplate.set(a.template.id, list);
    }

    void transact(async (tx) => {
      await insert(tx, "check_ins", {
        id: checkInId,
        checkpoint_id: checkpoint.id,
        user_id: userId,
        timestamp: stamp(now),
        method,
        reason: reason ?? null,
      });

      for (const group of byTemplate.values()) {
        const { template, openInstanceIds } = group[0];
        if (openInstanceIds.length > 0) {
          for (const instanceId of openInstanceIds) {
            for (const { section } of group) {
              if (existingSectionIds.has(sectionInstanceId(instanceId, section.id)))
                continue;
              await insertSectionInstance(tx, instanceId, section, now);
            }
          }
        } else if (
          template.trigger_type === "checkpoint" &&
          eligibleToday(template, now)
        ) {
          // Derived from the check-in, so a replayed write queue rebuilds the
          // same checklist rather than a second one.
          const instanceId = deterministicId(
            `checkin-checklist:${checkInId}:${template.id}`,
          );
          await insertInstance(tx, { template, instanceId, userId, now });
          for (const { section } of group) {
            await insertSectionInstance(tx, instanceId, section, now);
          }
          await recordActivity(tx, {
            eventType: "checklist.created",
            summary: `${template.name} created by check-in at ${checkpoint.name}`,
            subjectType: "checklist_instances",
            subjectId: instanceId,
            actorId: userId,
          });
        }
      }

      await recordActivity(tx, {
        eventType: method === "manual" ? "checkin.manual" : "checkin.scanned",
        summary:
          `${method === "manual" ? "Manual check-in" : "Checked in"} at ` +
          `${checkpoint.name}${reason ? ` — ${reason}` : ""}`,
        subjectType: "check_ins",
        subjectId: checkInId,
        actorId: userId,
      });
    })
      .then(() => setCreatedCheckInId(checkInId))
      .catch(console.error);
  }, [
    checkpoint,
    userId,
    dedupeSettled,
    secLoading,
    anchored,
    sectionsHere,
    existingCheckIn,
    createdCheckInId,
    method,
    reason,
  ]);

  const checkInId = existingCheckIn?.id ?? createdCheckInId ?? null;

  // What the visit screen shows: every visible section here on an open
  // instance. Rows this same effect just created stream in reactively, because
  // the query watching them is watching the device's own database.
  const applicableSections: ApplicableSection[] = useMemo(
    () =>
      sectionsHere
        .filter(
          (s) =>
            isVisibleNow({ hide_until: s.instance_hide_until }) && isVisibleNow(s),
        )
        .map((s) => ({
          id: s.id,
          label: s.label,
          instanceId: s.instance_id,
          checklistName: s.checklist_name ?? "Checklist",
          itemsTotal: s.items_total,
          itemsDone: s.items_done,
          complete: s.items_total > 0 && s.items_done === s.items_total,
        })),
    [sectionsHere],
  );

  // GPS capture — deliberately off the critical path (see spec: "GPS as a
  // background update"). Runs once per resolved check-in whose GPS is still
  // pending.
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("pending");
  const gpsStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!checkInId || !checkpoint || gpsStarted.current === checkInId) return;
    const prior = existingCheckIn?.id === checkInId ? existingCheckIn : null;
    if (prior && prior.within_radius != null) {
      setGpsStatus(prior.within_radius === 1 ? "clear" : "outside_radius");
      return;
    }
    if (!("geolocation" in navigator)) {
      setGpsStatus("unavailable");
      return;
    }
    gpsStarted.current = checkInId;
    const timeout = setTimeout(() => setGpsStatus("unavailable"), GPS_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeout);
        const { latitude, longitude } = pos.coords;
        const radius =
          checkpoint.gps_validation_radius ?? settings.gpsValidationRadiusDefault;
        // A checkpoint with no coordinates is never radius-flagged: there is
        // nothing to be outside of, and reporting a guard as out of position
        // because an admin never set a pin would be worse than saying nothing.
        const withinRadius =
          checkpoint.gps_lat != null && checkpoint.gps_lng != null
            ? distanceMeters(
                latitude,
                longitude,
                checkpoint.gps_lat,
                checkpoint.gps_lng,
              ) <= radius
            : true;
        void update(db, "check_ins", checkInId, {
          gps_lat: latitude,
          gps_lng: longitude,
          within_radius: withinRadius ? 1 : 0,
        });
        setGpsStatus(withinRadius ? "clear" : "outside_radius");
      },
      () => {
        clearTimeout(timeout);
        setGpsStatus("unavailable");
      },
      { timeout: GPS_TIMEOUT_MS, maximumAge: 0 },
    );
    return () => clearTimeout(timeout);
  }, [checkInId, checkpoint, existingCheckIn, settings.gpsValidationRadiusDefault]);

  const allComplete =
    applicableSections.length > 0 && applicableSections.every((s) => s.complete);

  return {
    loading: cpLoading || !dedupeSettled,
    checkpoint,
    checkInId,
    gpsStatus,
    applicableSections,
    allTriggeredComplete: allComplete,
    hasNoApplicable:
      Boolean(checkInId) && !secLoading && applicableSections.length === 0,
  };
}
