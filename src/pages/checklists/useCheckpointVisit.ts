// Shared core of the two ways a checkpoint visit is logged — the scanned
// NFC/QR deep link (CheckpointCheckinPage) and the Manual Check-In dialog —
// per pages/checkpoint-checkin.html and pages/manual-checkin-dialog.html:
// create-or-resume the Check-In record, materialize whatever the scan
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
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { deterministicId } from "../../lib/detId";
import { distanceMeters } from "../../lib/geo";
import { eligibleToday, isVisibleNow } from "../../lib/checklists";
import {
  buildInstanceTx,
  buildSectionInstanceTx,
  sectionInstanceId,
  TEMPLATE_INSTANTIATION_QUERY,
  type InstantiableSection,
} from "../../lib/checklistInstantiation";
import { activityTx } from "../../lib/activityLog";

const DEDUPE_WINDOW_MS = 5 * 60_000;
const GPS_TIMEOUT_MS = 20_000;

// Shared subquery shapes for the two place-match queries below.
const INSTANCE_SECTION_SHAPE = {
  checkpoints: {},
  location: {},
  items: {},
  instance: { template: {} },
};
const TEMPLATE_SECTION_SHAPE = {
  checkpoints: {},
  location: {},
  assets: {},
  items: {},
  template: {
    ...TEMPLATE_INSTANTIATION_QUERY,
    instances: {
      $: { where: { status: { $in: ["not_started", "in_progress"] } } },
    },
  },
};

function mergeById<T extends { id: string }>(
  a: T[] | undefined,
  b: T[] | undefined,
): T[] {
  const seen = new Set((a ?? []).map((r) => r.id));
  return [...(a ?? []), ...(b ?? []).filter((r) => !seen.has(r.id))];
}

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

  const { data: cpData, isLoading: cpLoading } = db.useQuery(
    checkpointId
      ? {
          checkpoints: {
            $: { where: { id: checkpointId } },
            location: {},
          },
          marinaSettings: {},
        }
      : null,
  );
  const checkpoint = cpData?.checkpoints?.[0] ?? null;
  const locationId = checkpoint?.location?.id;

  // Everything this scan could show or create: instance sections already
  // materialized here, and template sections anchored here (with enough of
  // their template to instantiate from). Two queries — one matching the
  // checkpoint itself, one its location (a checkpoint stands in for its
  // location) — merged below.
  const { data: cpSecData, isLoading: cpSecLoading } = db.useQuery(
    checkpoint && checkpointId
      ? {
          checklistInstanceSections: {
            $: { where: { "checkpoints.id": checkpointId } },
            ...INSTANCE_SECTION_SHAPE,
          },
          checklistTemplateSections: {
            $: { where: { "checkpoints.id": checkpointId } },
            ...TEMPLATE_SECTION_SHAPE,
          },
        }
      : null,
  );
  const { data: locSecData, isLoading: locSecLoading } = db.useQuery(
    checkpoint && locationId
      ? {
          checklistInstanceSections: {
            $: { where: { "location.id": locationId } },
            ...INSTANCE_SECTION_SHAPE,
          },
          checklistTemplateSections: {
            $: { where: { "location.id": locationId } },
            ...TEMPLATE_SECTION_SHAPE,
          },
        }
      : null,
  );
  const secLoading = cpSecLoading || (locationId != null && locSecLoading);
  const instanceSections = useMemo(
    () =>
      mergeById(
        cpSecData?.checklistInstanceSections,
        locSecData?.checklistInstanceSections,
      ),
    [cpSecData, locSecData],
  );
  const templateSections = useMemo(
    () =>
      mergeById(
        cpSecData?.checklistTemplateSections,
        locSecData?.checklistTemplateSections,
      ),
    [cpSecData, locSecData],
  );

  const { data: resumedData, isLoading: resumedLoading } = db.useQuery(
    resumeCheckInId ? { checkIns: { $: { where: { id: resumeCheckInId } } } } : null,
  );
  // The dedupe cutoff is pinned to when this visit mounted rather than
  // recomputed per render. db.useQuery subscribes through
  // useSyncExternalStore, so a query object that differs every render — and
  // `Date.now()` differs every millisecond — resubscribes every render,
  // pushes a fresh snapshot, and re-renders: an infinite loop that React
  // aborts with "Maximum update depth exceeded". A cutoff that drifts by
  // milliseconds bought nothing anyway against a 5-minute window.
  // Pinned once for the lifetime of this visit. Only the create-or-resume
  // effect below reads it, and that runs once, so it never needs to drift.
  const [dedupeSince] = useState(() => new Date(Date.now() - DEDUPE_WINDOW_MS));

  // Dedupe exists because the scanned screen is reached by re-opening a URL
  // (reload, resumed tab). The manual dialog is opened from inside a running
  // session and closes on submit, so it needs no dedupe — and applying it
  // would silently swallow a legitimate second manual check-in at the same
  // checkpoint, per the Manual Check-In spec.
  const { data: recentData, isLoading: recentLoading } = db.useQuery(
    method === "scanned" && !resumeCheckInId && checkpointId && userId
      ? {
          checkIns: {
            $: {
              where: {
                "checkpoint.id": checkpointId,
                "user.id": userId,
                timestamp: { $gt: dedupeSince },
              },
              order: { timestamp: "desc" },
            },
          },
        }
      : null,
  );

  const existingCheckIn =
    resumedData?.checkIns?.[0] ?? recentData?.checkIns?.[0] ?? null;
  const dedupeSettled =
    method === "manual" ? true : resumeCheckInId ? !resumedLoading : !recentLoading;

  const [createdCheckInId, setCreatedCheckInId] = useState<string | null>(null);
  const creating = useRef(false);

  // Create the Check-In — and materialize what the scan triggers — exactly
  // once per fresh visit; if an existing check-in resolves via URL/dedupe
  // first, this never fires (its scan already materialized these rows).
  useEffect(() => {
    if (!checkpoint || !userId || !dedupeSettled || secLoading) return;
    if (existingCheckIn || createdCheckInId || creating.current) return;
    if (method === "manual" && !reason) return;
    creating.current = true;

    const checkInId = id();
    const now = new Date();

    // A template section is anchored here when its own trigger names this
    // checkpoint (checkpoint trigger) or this checkpoint's location
    // (location trigger). The queries over-fetch — e.g. manual sections that
    // merely sit in this location — so filter to the genuinely event-anchored.
    const anchoredHere = templateSections.filter(
      (s) =>
        s.isActive &&
        (s.triggerType === "checkpoint"
          ? (s.checkpoints ?? []).some((c) => c.id === checkpointId)
          : s.triggerType === "location" &&
            locationId != null &&
            s.location?.id === locationId),
    );
    const existingSectionIds = new Set(instanceSections.map((s) => s.id));

    const materializeTxns = [];
    let generatedInstanceId: string | null = null;
    const byTemplate = new Map<string, { template: NonNullable<(typeof anchoredHere)[number]["template"]>; sections: typeof anchoredHere }>();
    for (const s of anchoredHere) {
      if (!s.template) continue;
      const entry = byTemplate.get(s.template.id) ?? { template: s.template, sections: [] };
      entry.sections.push(s);
      byTemplate.set(s.template.id, entry);
    }
    for (const { template, sections } of byTemplate.values()) {
      const openInstances = template.instances ?? [];
      if (openInstances.length > 0) {
        // Lazy sections onto every open instance that doesn't have them yet.
        for (const inst of openInstances) {
          for (const s of sections) {
            if (existingSectionIds.has(sectionInstanceId(inst.id, s.id))) continue;
            materializeTxns.push(
              ...buildSectionInstanceTx(inst.id, s as InstantiableSection, now),
            );
          }
        }
      } else if (template.triggerType === "checkpoint" && eligibleToday(template)) {
        // No open instance and the template itself is checkpoint-triggered:
        // this scan creates the whole checklist, its eager sections, and the
        // section that brought us here.
        const instanceId = deterministicId(`checkin-checklist:${checkInId}:${template.id}`);
        generatedInstanceId ??= instanceId;
        materializeTxns.push(
          ...buildInstanceTx({ template, instanceId, userId, now }),
          ...sections.flatMap((s) =>
            buildSectionInstanceTx(instanceId, s as InstantiableSection, now),
          ),
          activityTx({
            eventType: "checklist.created",
            summary: `${template.name} created by check-in at ${checkpoint.name}`,
            subjectType: "checklistInstances",
            subjectId: instanceId,
            actorId: userId,
          }),
        );
      }
    }

    void db
      .transact([
        db.tx.checkIns[checkInId]
          .update({
            timestamp: Date.now(),
            method,
            ...(reason ? { reason } : {}),
          })
          .link({
            checkpoint: checkpointId!,
            user: userId,
            ...(generatedInstanceId ? { generatedChecklist: generatedInstanceId } : {}),
          }),
        ...materializeTxns,
        activityTx({
          eventType: method === "manual" ? "checkin.manual" : "checkin.scanned",
          summary:
            `${method === "manual" ? "Manual check-in" : "Checked in"} at ` +
            `${checkpoint.name}${reason ? ` — ${reason}` : ""}`,
          subjectType: "checkIns",
          subjectId: checkInId,
          actorId: userId,
        }),
      ])
      .then(() => setCreatedCheckInId(checkInId))
      .catch(console.error);
  }, [
    checkpoint,
    userId,
    dedupeSettled,
    secLoading,
    templateSections,
    instanceSections,
    existingCheckIn,
    createdCheckInId,
    method,
    reason,
    checkpointId,
    locationId,
  ]);

  const checkInId = existingCheckIn?.id ?? createdCheckInId ?? null;

  // What the visit screen shows: every visible section here on an open
  // instance. A section with checkpoint links belongs to those checkpoints
  // only; one with just a location belongs to every checkpoint in it. Rows
  // this same effect just created stream in reactively.
  const applicableSections: ApplicableSection[] = useMemo(() => {
    return instanceSections
      .filter((s) => {
        const inst = s.instance;
        if (!inst || (inst.status !== "not_started" && inst.status !== "in_progress"))
          return false;
        if (!isVisibleNow(inst) || !isVisibleNow(s)) return false;
        const cps = s.checkpoints ?? [];
        return cps.length > 0
          ? cps.some((c) => c.id === checkpointId)
          : locationId != null && s.location?.id === locationId;
      })
      .map((s) => {
        const items = s.items ?? [];
        const done = items.filter((i) => i.completedAt != null).length;
        return {
          id: s.id,
          label: s.label,
          instanceId: s.instance!.id,
          checklistName: s.instance!.template?.name ?? "Checklist",
          itemsTotal: items.length,
          itemsDone: done,
          complete: items.length > 0 && done === items.length,
        };
      })
      .sort(
        (a, b) =>
          a.checklistName.localeCompare(b.checklistName) ||
          a.label.localeCompare(b.label),
      );
  }, [instanceSections, checkpointId, locationId]);

  // GPS capture — deliberately off the critical path (see spec: "GPS as a
  // background update"). Runs once per resolved Check-In whose GPS is still
  // pending.
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("pending");
  const gpsStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!checkInId || !checkpoint || gpsStarted.current === checkInId) return;
    const resumed = existingCheckIn?.id === checkInId ? existingCheckIn : null;
    if (resumed && resumed.withinRadius != null) {
      setGpsStatus(resumed.withinRadius ? "clear" : "outside_radius");
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
          checkpoint.gpsValidationRadius ??
          cpData?.marinaSettings?.[0]?.gpsValidationRadiusDefault ??
          50;
        const withinRadius =
          checkpoint.gpsLat != null && checkpoint.gpsLng != null
            ? distanceMeters(latitude, longitude, checkpoint.gpsLat, checkpoint.gpsLng) <=
              radius
            : true;
        void db.transact(
          db.tx.checkIns[checkInId].update({
            gpsLat: latitude,
            gpsLng: longitude,
            withinRadius,
          }),
        );
        setGpsStatus(withinRadius ? "clear" : "outside_radius");
      },
      () => {
        clearTimeout(timeout);
        setGpsStatus("unavailable");
      },
      { timeout: GPS_TIMEOUT_MS, maximumAge: 0 },
    );
    return () => clearTimeout(timeout);
  }, [checkInId, checkpoint, existingCheckIn, cpData]);

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
