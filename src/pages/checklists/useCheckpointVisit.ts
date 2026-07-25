// Shared core of the two ways a checkpoint visit is logged — the scanned
// NFC/QR deep link (CheckpointCheckinPage) and the Manual Check-In dialog —
// per pages/checkpoint-checkin.html and pages/manual-checkin-dialog.html:
// create-or-resume the Check-In record, evaluate which checklist templates
// apply right now, and capture GPS in the background without blocking
// either flow.
import { useEffect, useMemo, useRef, useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { deterministicId } from "../../lib/detId";
import { distanceMeters } from "../../lib/geo";
import { templateAppliesNow } from "../../lib/checklists";

const DEDUPE_WINDOW_MS = 5 * 60_000;
const GPS_TIMEOUT_MS = 20_000;

export type GpsStatus = "pending" | "clear" | "outside_radius" | "unavailable";

export interface ApplicableChecklist {
  id: string;
  templateName: string;
  status: string;
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
            checklistTemplates: {},
          },
          marinaSettings: {},
        }
      : null,
  );
  const checkpoint = cpData?.checkpoints?.[0] ?? null;

  const { data: resumedData, isLoading: resumedLoading } = db.useQuery(
    resumeCheckInId ? { checkIns: { $: { where: { id: resumeCheckInId } } } } : null,
  );
  const { data: recentData, isLoading: recentLoading } = db.useQuery(
    !resumeCheckInId && checkpointId && userId
      ? {
          checkIns: {
            $: {
              where: {
                "checkpoint.id": checkpointId,
                "user.id": userId,
                timestamp: { $gt: new Date(Date.now() - DEDUPE_WINDOW_MS) },
              },
              order: { timestamp: "desc" },
            },
          },
        }
      : null,
  );

  const existingCheckIn =
    resumedData?.checkIns?.[0] ?? recentData?.checkIns?.[0] ?? null;
  const dedupeSettled = resumeCheckInId ? !resumedLoading : !recentLoading;

  const [createdCheckInId, setCreatedCheckInId] = useState<string | null>(null);
  const creating = useRef(false);

  // Create the Check-In (and its applicable Checklists) exactly once per
  // fresh visit — if an existing one resolves via URL/dedupe first, this
  // never fires.
  useEffect(() => {
    if (!checkpoint || !userId || !dedupeSettled) return;
    if (existingCheckIn || createdCheckInId || creating.current) return;
    if (method === "manual" && !reason) return;
    creating.current = true;

    const checkInId = id();
    const applicable = (checkpoint.checklistTemplates ?? []).filter((t) =>
      templateAppliesNow(t),
    );
    const checklistTxns = applicable.map((t) => {
      const checklistId = deterministicId(`checkin-checklist:${checkInId}:${t.id}`);
      return db.tx.checklists[checklistId]
        .update({
          status: "not_started",
          triggeredBy: { type: "checkpoint", checkpointId, checkInId },
        })
        .link({
          template: t.id,
          ...(t.assignmentMode === "triggering_user" ? { assignedTo: userId } : {}),
        });
    });

    void db
      .transact([
        db.tx.checkIns[checkInId]
          .update({
            timestamp: Date.now(),
            method,
            ...(reason ? { reason } : {}),
          })
          .link({ checkpoint: checkpointId!, user: userId }),
        ...checklistTxns,
        ...(applicable.length > 0
          ? [
              db.tx.checkIns[checkInId].link({
                generatedChecklist: deterministicId(
                  `checkin-checklist:${checkInId}:${applicable[0].id}`,
                ),
              }),
            ]
          : []),
      ])
      .then(() => setCreatedCheckInId(checkInId))
      .catch(console.error);
  }, [
    checkpoint,
    userId,
    dedupeSettled,
    existingCheckIn,
    createdCheckInId,
    method,
    reason,
    checkpointId,
  ]);

  const checkInId = existingCheckIn?.id ?? createdCheckInId ?? null;

  const applicableTemplates = useMemo(
    () => (checkpoint?.checklistTemplates ?? []).filter((t) => templateAppliesNow(t)),
    [checkpoint],
  );
  const checklistIds = useMemo(
    () =>
      checkInId
        ? applicableTemplates.map((t) =>
            deterministicId(`checkin-checklist:${checkInId}:${t.id}`),
          )
        : [],
    [checkInId, applicableTemplates],
  );

  const { data: checklistData } = db.useQuery(
    checklistIds.length > 0
      ? { checklists: { $: { where: { id: { $in: checklistIds } } }, template: {} } }
      : null,
  );
  const applicableChecklists: ApplicableChecklist[] = (checklistData?.checklists ?? [])
    .map((c) => ({ id: c.id, templateName: c.template?.name ?? "Checklist", status: c.status }))
    .sort((a, b) => a.templateName.localeCompare(b.templateName));

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
    applicableChecklists.length > 0 &&
    applicableChecklists.every((c) => c.status === "complete");

  return {
    loading: cpLoading || !dedupeSettled,
    checkpoint,
    checkInId,
    gpsStatus,
    applicableChecklists,
    allTriggeredComplete: allComplete,
    hasNoApplicable: Boolean(checkInId) && applicableTemplates.length === 0,
  };
}
