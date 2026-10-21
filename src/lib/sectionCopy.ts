import { isStateCheck, type ItemConfig, type ItemType } from "./checklists";

/**
 * Copy a template section to other locations — the plan.
 *
 * The source section is the pattern: whatever it asks, wherever it is, is what
 * each copy asks at its own place. Everything decided here is pure — names,
 * positions, which checkpoint to attach or create — and `src/data/checklists.ts`
 * only executes it (AdminChecklistTemplatesPage.spec.md § Copy a section to
 * locations).
 */

export interface CopySourceSection {
  id: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
  isActive: boolean;
  triggerType: string;
  /** Raw column values, copied as-is. */
  triggerConfig: string | null;
  hideUntilRule: string | null;
  dueBy: string | null;
  /** Live items, in position order. */
  items: { type: ItemType; label: string; config: ItemConfig }[];
  /** Attached to the source. */
  checkpoints: { id: string; name: string; gpsValidationRadius: number | null }[];
  assetIds: string[];
}

export interface CopyTarget {
  id: string;
  name: string;
}

export type CheckpointMode = "all" | "create" | "none";

export interface CopyContext {
  /** Every section of the template, in position order. */
  templateSections: { id: string; locationId: string | null }[];
  /** Every checkpoint the device knows. */
  checkpoints: { id: string; name: string; locationId: string | null }[];
  newGuid?: () => string;
}

export interface PlannedCheckpoint {
  name: string;
  locationId: string;
  guidUrl: string;
  gpsValidationRadius: number | null;
}

export interface PlannedSection {
  name: string;
  locationId: string;
  position: number;
  isActive: boolean;
  triggerType: string;
  triggerConfig: string | null;
  hideUntilRule: string | null;
  dueBy: string | null;
  items: { type: ItemType; label: string; config: ItemConfig; position: number }[];
  attachCheckpointIds: string[];
  createCheckpoints: PlannedCheckpoint[];
  assetIds: string[];
}

export interface SectionCopyPlan {
  sections: PlannedSection[];
  /** Existing sections that move down to make room. */
  reposition: { sectionId: string; position: number }[];
  /** Targets left out: the source's own place, or one already in the template. */
  skippedTargetIds: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The substitution rule. The source location's name is searched for in the
 * text, case-insensitively, and every occurrence becomes the target's name.
 * Not found — or nothing to search for — and the target's name is appended
 * after a space. "Dock A walk" → "Dock B walk"; "Door check" → "Door check
 * Dock B".
 */
export function substituteLocationName(
  text: string,
  sourceName: string | null | undefined,
  targetName: string,
): string {
  const needle = (sourceName ?? "").trim();
  if (needle) {
    const re = new RegExp(escapeRegExp(needle), "gi");
    if (re.test(text)) return text.replace(re, targetName);
  }
  const base = text.trim();
  return base ? `${base} ${targetName}` : targetName;
}

/**
 * Which of a template's locations are spoken for: the source's own, and any
 * with a section already. Running the copy twice adds nothing.
 */
export function coveredLocationIds(
  source: { locationId: string | null },
  templateSections: { locationId: string | null }[],
): Set<string> {
  const covered = new Set<string>();
  if (source.locationId) covered.add(source.locationId);
  for (const s of templateSections) if (s.locationId) covered.add(s.locationId);
  return covered;
}

export function planSectionCopies(
  source: CopySourceSection,
  targets: CopyTarget[],
  mode: CheckpointMode,
  ctx: CopyContext,
): SectionCopyPlan {
  const newGuid = ctx.newGuid ?? (() => crypto.randomUUID());
  const covered = coveredLocationIds(source, ctx.templateSections);
  const skippedTargetIds: string[] = [];
  const kept: CopyTarget[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    if (covered.has(t.id) || seen.has(t.id)) skippedTargetIds.push(t.id);
    else {
      seen.add(t.id);
      kept.push(t);
    }
  }

  const sourceIndex = ctx.templateSections.findIndex((s) => s.id === source.id);
  // A source the context does not list goes at the end — never on top of
  // something that exists.
  const firstPosition =
    sourceIndex < 0 ? ctx.templateSections.length : sourceIndex + 1;
  const reposition = ctx.templateSections
    .slice(firstPosition)
    .map((s, i) => ({ sectionId: s.id, position: firstPosition + kept.length + i }));

  const sections = kept.map((target, k): PlannedSection => {
    const rename = (text: string) =>
      substituteLocationName(text, source.locationName, target.name);

    const items = source.items
      .filter((i) => i.type !== "end_shift")
      .map((i, position) => {
        const cfg = i.config as ItemConfig & { locationId?: string };
        const repoint =
          isStateCheck(i.type) &&
          source.locationId != null &&
          cfg.locationId === source.locationId;
        return {
          type: i.type,
          label: rename(i.label),
          config: (repoint ? { ...cfg, locationId: target.id } : cfg) as ItemConfig,
          position,
        };
      });

    const atTarget = ctx.checkpoints.filter((c) => c.locationId === target.id);
    const attachCheckpointIds: string[] = [];
    const createCheckpoints: PlannedCheckpoint[] = [];
    if (mode === "all") {
      attachCheckpointIds.push(...atTarget.map((c) => c.id));
    } else if (mode === "create") {
      for (const cp of source.checkpoints) {
        const name = rename(cp.name);
        const existing = atTarget.find(
          (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase(),
        );
        if (existing) {
          if (!attachCheckpointIds.includes(existing.id)) attachCheckpointIds.push(existing.id);
        } else if (!createCheckpoints.some((c) => c.name === name)) {
          createCheckpoints.push({
            name,
            locationId: target.id,
            guidUrl: newGuid(),
            gpsValidationRadius: cp.gpsValidationRadius,
          });
        }
      }
    }

    return {
      name: rename(source.name),
      locationId: target.id,
      position: firstPosition + k,
      isActive: source.isActive,
      triggerType: source.triggerType,
      triggerConfig: source.triggerConfig,
      hideUntilRule: source.hideUntilRule,
      dueBy: source.dueBy,
      items,
      attachCheckpointIds,
      createCheckpoints,
      assetIds: [...source.assetIds],
    };
  });

  return { sections, reposition, skippedTargetIds };
}
