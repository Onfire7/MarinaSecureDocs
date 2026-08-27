import type { LockContext } from "@powersync/web";
import { id as newId } from "../lib/db";
import { insert, transact } from "./sql";

// The Setup Wizard's one write.
//
// It creates a marina's whole location tree in a pass — 900 slips across 30
// docks is an ordinary run — so it is chunked rather than sent as one enormous
// transaction. Each chunk is atomic; the run as a whole is not, and cannot
// usefully be: a failure halfway leaves the docks created and the slips not,
// which is recoverable by running it again (the wizard skips what already
// exists) where a rollback of ten thousand rows on a phone is not.
//
// Ordering matters more than it looks. A child references its container and a
// checkpoint references its location, so containers are written before
// children and both before checkpoints — otherwise a chunk boundary could put
// a foreign key ahead of the row it points at, and PostgREST would reject the
// whole chunk on upload while the local write had already succeeded.

const CHUNK = 150;

export interface SetupContainer {
  /** Set when the container already exists; absent means create it. */
  existingId?: string;
  name: string;
  /** Give the container its own checkpoint. */
  checkpoint: boolean;
  /** Names of children to create under it. */
  children: string[];
}

export interface SetupPlan {
  anchorId: string | null;
  containerTypeId: string;
  childTypeId: string;
  /** The status a newly created location starts in, where its type tracks one. */
  containerStatusId: string | null;
  childStatusId: string | null;
  childCheckpoints: boolean;
  containers: SetupContainer[];
  tour: { name: string; mode: string } | null;
  /** Attach every new checkpoint to this template, one section per location. */
  templateId: string | null;
  /** Where the new sections start in the template's order. */
  templateSectionStart: number;
}

type Write = (tx: LockContext) => Promise<void>;

export async function runSetupPlan(
  plan: SetupPlan,
  onProgress: (written: number, total: number) => void,
): Promise<{ containers: number; children: number; checkpoints: number }> {
  const containerWrites: Write[] = [];
  const childWrites: Write[] = [];
  const checkpointWrites: Write[] = [];
  const tailWrites: Write[] = [];

  const newCheckpoints: { id: string; locationId: string; locationName: string }[] = [];
  let containers = 0;
  let children = 0;

  for (const container of plan.containers) {
    const containerId = container.existingId ?? newId();
    if (!container.existingId) {
      containers++;
      containerWrites.push((tx) =>
        insert(tx, "locations", {
          id: containerId,
          name: container.name,
          location_type_id: plan.containerTypeId,
          parent_id: plan.anchorId,
          status_id: plan.containerStatusId,
          reservation_enabled: 0,
          lease_enabled: 0,
        }).then(() => {}),
      );
    }

    if (container.checkpoint) {
      const cpId = newId();
      newCheckpoints.push({
        id: cpId,
        locationId: containerId,
        locationName: container.name,
      });
      checkpointWrites.push((tx) =>
        insert(tx, "checkpoints", {
          id: cpId,
          name: container.name,
          guid_url: crypto.randomUUID(),
          location_id: containerId,
        }).then(() => {}),
      );
    }

    for (const childName of container.children) {
      const childId = newId();
      children++;
      childWrites.push((tx) =>
        insert(tx, "locations", {
          id: childId,
          name: childName,
          location_type_id: plan.childTypeId,
          parent_id: containerId,
          status_id: plan.childStatusId,
          reservation_enabled: 0,
          lease_enabled: 0,
        }).then(() => {}),
      );
      if (plan.childCheckpoints) {
        const cpId = newId();
        newCheckpoints.push({ id: cpId, locationId: childId, locationName: childName });
        checkpointWrites.push((tx) =>
          insert(tx, "checkpoints", {
            id: cpId,
            name: childName,
            guid_url: crypto.randomUUID(),
            location_id: childId,
          }).then(() => {}),
        );
      }
    }
  }

  if (plan.tour && newCheckpoints.length > 0) {
    const tour = plan.tour;
    tailWrites.push(async (tx) => {
      const tourId = await insert(tx, "tours", { name: tour.name, mode: tour.mode });
      for (const [position, cp] of newCheckpoints.entries()) {
        await insert(tx, "tour_checkpoints", {
          tour_id: tourId,
          checkpoint_id: cp.id,
          position,
        });
      }
    });
  }

  if (plan.templateId && newCheckpoints.length > 0) {
    // Checkpoint attachment lives on template sections, and a section has
    // exactly one location — so the batch becomes one checkpoint-triggered
    // section per location, named after it.
    const byLocation = new Map<string, { name: string; cpIds: string[] }>();
    for (const cp of newCheckpoints) {
      const group = byLocation.get(cp.locationId) ?? {
        name: cp.locationName,
        cpIds: [],
      };
      group.cpIds.push(cp.id);
      byLocation.set(cp.locationId, group);
    }
    let position = plan.templateSectionStart;
    for (const [locationId, group] of byLocation) {
      const sectionPosition = position++;
      tailWrites.push(async (tx) => {
        const sectionId = await insert(tx, "checklist_template_sections", {
          template_id: plan.templateId,
          name: group.name,
          position: sectionPosition,
          is_active: 1,
          trigger_type: "checkpoint",
          location_id: locationId,
        });
        for (const cpId of group.cpIds) {
          await insert(tx, "template_section_checkpoints", {
            section_id: sectionId,
            checkpoint_id: cpId,
          });
        }
      });
    }
  }

  const ordered = [
    ...containerWrites,
    ...childWrites,
    ...checkpointWrites,
    ...tailWrites,
  ];
  for (let i = 0; i < ordered.length; i += CHUNK) {
    const chunk = ordered.slice(i, i + CHUNK);
    onProgress(Math.min(i + CHUNK, ordered.length), ordered.length);
    await transact(async (tx) => {
      for (const write of chunk) await write(tx);
    });
  }

  return { containers, children, checkpoints: newCheckpoints.length };
}
