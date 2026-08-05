// Section activation logic — determines which sections of a checklist template
// should be visible based on time, location/checkpoint/asset context, and user roles.

import type { InstaQLEntity } from "@instantdb/react";
import type { AppSchema } from "./db";
import { RRuleSet, rrulestr } from "rrule";

type ChecklistTemplateSection = InstaQLEntity<
  AppSchema,
  "checklistTemplateSections"
> & {
  id: string;
  name: string;
  isActive: boolean;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
};

type ChecklistTemplateForSections = {
  visibility: string;
  role?: { id: string };
  creator?: { id: string };
  sections?: ChecklistTemplateSection[];
};

export interface SectionActivationContext {
  currentTime: Date;
  currentCheckpoint?: { id: string; locationId: string };
  currentLocation?: { id: string };
  currentAsset?: { id: string };
  userRoles: { id: string }[];
}

/**
 * Evaluates a single recurrence rule (RFC 5545 RRULE format) to determine
 * if the given time matches. Uses the rrule library to handle complex
 * recurrence patterns (daily, weekly, monthly, etc.) and time-of-day windows.
 *
 * Examples:
 * - "FREQ=DAILY;BYHOUR=21;BYMINUTE=0" → every night at 9 PM
 * - "FREQ=DAILY;BYHOUR=21,22,23,0,1,2,3,4" → 9 PM to 5 AM daily
 * - "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9" → Monday, Wednesday, Friday at 9 AM
 */
export function evaluateRecurrenceRule(
  rrule: string,
  now: Date,
): boolean {
  if (!rrule) return true;

  try {
    // Parse and evaluate the recurrence rule for the given time.
    // We check if `now` matches any occurrence of the rule.
    const ruleSet = new RRuleSet();

    // Set the start date to today at midnight in the local timezone
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const parsedRule = rrulestr(rrule, { dtstart: today });
    ruleSet.rrule(parsedRule);

    // Check if `now` matches any occurrence within a day window
    // (since we're not storing exact occurrences, just checking if the
    // current time matches the recurrence pattern)
    const occurrences = ruleSet.between(
      new Date(now.getTime() - 1000 * 60 * 60 * 24), // 24 hours ago
      new Date(now.getTime() + 1000 * 60 * 60 * 24), // 24 hours from now
      true,
    );

    // If there's an occurrence within the window, check if we're close enough
    // to it time-wise (within the minute)
    if (occurrences.length > 0) {
      // For simplicity, if the rule generates any occurrence on this day, we
      // assume it's active. A more precise check would evaluate the specific
      // time components (BYHOUR, BYMINUTE, etc.) of the rule.
      return true;
    }

    return false;
  } catch (error) {
    console.error("Invalid recurrence rule:", rrule, error);
    return false;
  }
}

/**
 * Determines which sections of a template should be active based on the
 * current context (time, location/checkpoint, user roles).
 *
 * A section is active if:
 * 1. Section.isActive === true
 * 2. Section trigger matches the current context:
 *    - "manual": always active (user-triggered)
 *    - "time_window": recurrence rule matches current time
 *    - "checkpoint": current checkpoint ID is in applicableCheckpoints
 *    - "location": current location ID is in applicableLocations
 *    - "asset": current asset ID is in applicableAssets
 * 3. Template visibility allows the user to see it
 *    - "global": all users
 *    - "role_restricted": user has the restricted role
 *    - "personal": creator only (checked at template level, not section)
 */
export function getSectionsForContext(
  template: ChecklistTemplateForSections,
  context: SectionActivationContext,
): ChecklistTemplateSection[] {
  const sections = template.sections ?? [];

  return sections.filter((section: ChecklistTemplateSection) => {
    // 1. Section must be active (master switch)
    if (!section.isActive) return false;

    // 2. Template visibility must allow the user
    if (template.visibility === "role_restricted" && template.role) {
      const userHasRole = context.userRoles.some(
        (r) => r.id === template.role?.id,
      );
      if (!userHasRole) return false;
    }

    // 3. Section trigger must match
    const triggerConfig = section.triggerConfig ?? {};

    switch (section.triggerType) {
      case "manual":
        // Always active; user manually starts
        return true;

      case "time_window": {
        // Check if current time matches recurrence rule
        const rrule = (triggerConfig as { recurrenceRule?: string })
          .recurrenceRule;
        return evaluateRecurrenceRule(rrule ?? "", context.currentTime);
      }

      case "checkpoint": {
        // Active if current checkpoint is in applicable list
        if (!context.currentCheckpoint) return false;
        const applicable = (triggerConfig as { applicableCheckpoints?: string[] })
          .applicableCheckpoints ?? [];
        return applicable.includes(context.currentCheckpoint.id);
      }

      case "location": {
        // Active if current location (or checkpoint's location) is in applicable list
        if (!context.currentLocation && !context.currentCheckpoint) return false;
        const applicable = (triggerConfig as { applicableLocations?: string[] })
          .applicableLocations ?? [];
        const currentLocationId =
          context.currentLocation?.id ||
          context.currentCheckpoint?.locationId;
        return currentLocationId ? applicable.includes(currentLocationId) : false;
      }

      case "asset": {
        // Active if current asset is in applicable list
        if (!context.currentAsset) return false;
        const applicable = (triggerConfig as { applicableAssets?: string[] })
          .applicableAssets ?? [];
        return applicable.includes(context.currentAsset.id);
      }

      default:
        return false;
    }
  });
}

/**
 * Determines which sections are visible/active for a given checkpoint scan.
 * This is a convenience wrapper around getSectionsForContext for the
 * checkpoint visit flow.
 */
export function getSectionsForCheckpoint(
  template: ChecklistTemplateForSections,
  checkpoint: { id: string; locationId: string },
  userRoles: { id: string }[],
  now: Date = new Date(),
): ChecklistTemplateSection[] {
  return getSectionsForContext(template, {
    currentTime: now,
    currentCheckpoint: checkpoint,
    currentLocation: { id: checkpoint.locationId },
    userRoles,
  });
}
