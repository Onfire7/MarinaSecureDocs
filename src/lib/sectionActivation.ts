// Which sections of a checklist template are live right now.
//
// A template is one checklist (e.g. "Night Security"); its sections are the
// parts of it that come and go — by clock ("dock walk, 9pm–5am") or by place
// ("Gate A", opened when Gate A's checkpoint is scanned). Filtering happens
// here rather than at the query, because whether a section applies depends on
// the moment and the checkpoint in hand, neither of which is a stored field.
import { rrulestr } from "rrule";
import type { ResolvedSection, SectionTriggerConfig } from "./checklists";

export interface SectionActivationContext {
  currentTime: Date;
  /** The checkpoint just scanned, if this evaluation came from a check-in. */
  currentCheckpoint?: { id: string; locationId?: string };
  currentLocation?: { id: string };
  currentAsset?: { id: string };
}

/** Default window a time_window section stays open for, when unset. */
const DEFAULT_WINDOW_MINUTES = 60;

/**
 * Whether `now` falls inside an occurrence window of a recurrence rule.
 *
 * An RRULE names *instants*, not spans — "FREQ=DAILY;BYHOUR=21" is 9pm every
 * night, a point. A section needs a span, so each occurrence opens a window
 * `durationMinutes` long and the rule is live while `now` sits inside one:
 * that pair expresses "9pm to 5am" as BYHOUR=21 + 480 minutes, and gets
 * midnight-wrapping for free rather than by comparing hour numbers.
 *
 * Implemented as a lookback: an occurrence in `[now - duration, now]` is
 * exactly an occurrence O with `O <= now < O + duration`.
 */
export function evaluateRecurrenceRule(
  rule: string,
  now: Date,
  durationMinutes: number = DEFAULT_WINDOW_MINUTES,
): boolean {
  // No rule configured = no time restriction. An admin who picks the
  // time_window trigger and saves nothing yet should see the section, not
  // lose it silently until they fill the field in.
  if (!rule.trim()) return true;

  const durationMs = Math.max(1, durationMinutes) * 60_000;
  const windowStart = new Date(now.getTime() - durationMs);

  try {
    // dtstart must precede the lookback window or the rule generates nothing
    // inside it; a week back covers every FREQ we expose without making
    // expansion expensive.
    const dtstart = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const parsed = rrulestr(rule, { dtstart });
    return parsed.between(windowStart, now, true).length > 0;
  } catch (error) {
    // A malformed rule shouldn't hide a section — an admin typo would quietly
    // drop items off a guard's checklist, which is worse than showing extra.
    console.error("Invalid section recurrence rule:", rule, error);
    return true;
  }
}

/** Whether one section's trigger matches the given moment and place. */
export function sectionApplies(
  section: ResolvedSection,
  context: SectionActivationContext,
): boolean {
  if (!section.isActive) return false;

  const cfg: SectionTriggerConfig = section.triggerConfig ?? {};

  switch (section.triggerType) {
    // Always on: the section is part of the checklist whenever the checklist
    // is. This is also what legacy (pre-sections) templates resolve to.
    case "manual":
      return true;

    case "time_window":
      return evaluateRecurrenceRule(
        cfg.recurrenceRule ?? "",
        context.currentTime,
        cfg.durationMinutes,
      );

    case "checkpoint": {
      if (!context.currentCheckpoint) return false;
      return (cfg.applicableCheckpoints ?? []).includes(
        context.currentCheckpoint.id,
      );
    }

    case "location": {
      // A checkpoint stands in for its location: scanning Gate A opens the
      // sections filed under the dock Gate A belongs to, without every
      // section having to enumerate checkpoints.
      const locationId =
        context.currentLocation?.id ?? context.currentCheckpoint?.locationId;
      if (!locationId) return false;
      return (cfg.applicableLocations ?? []).includes(locationId);
    }

    case "asset": {
      if (!context.currentAsset) return false;
      return (cfg.applicableAssets ?? []).includes(context.currentAsset.id);
    }

    default:
      return false;
  }
}

/** The subset of `sections` live for the given context, order preserved. */
export function activeSections(
  sections: ResolvedSection[],
  context: SectionActivationContext,
): ResolvedSection[] {
  return sections.filter((s) => sectionApplies(s, context));
}
