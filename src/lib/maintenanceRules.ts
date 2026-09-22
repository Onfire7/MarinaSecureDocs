// Asset maintenance rules — meter-based rules fire inline on the write that
// records a new meter reading, since that is the only moment the value changes.
//
// Time-based rules ("every 90 days since last completed") are not modelled
// here yet. They are specified to run client-side on the same deterministic-id
// pattern as recurring checklists rather than as a scheduled function — see
// docs/adr/0004-client-first-execution.md and docs/ROADMAP.md. Nothing
// generates them today, which is why they are filtered out below rather than
// merely unhandled.
//
// Everything here is pure and structural: it names the shape of the rows it
// needs and nothing about where they came from, so it can be tested without a
// database and stayed unchanged through the migration off one.

export interface MeterRule {
  /** "meter" or "time"; anything else is ignored, as "time" currently is. */
  kind: string;
  every: number;
  label?: string | null;
}

export interface AssetLike {
  name: string;
}

export interface MeterReadingLike {
  value: number;
  timestamp: string | number;
}

export interface TicketLike {
  title: string;
  auto_generated: number;
  created_at: string | number;
  resolved_at?: string | number | null;
}

export function maintenanceRuleTitle(asset: AssetLike, rule: MeterRule): string {
  return `Maintenance due: ${asset.name} — ${rule.label ?? `every ${rule.every}`}`;
}

const ms = (value: string | number) => new Date(value).getTime();

/**
 * A rule is due once the new reading has advanced a full interval past its
 * baseline — the reading nearest the last time this same rule's ticket was
 * resolved, or the asset's earliest known reading if it has never fired — and
 * only if no ticket for it is already open.
 *
 * The open-ticket check is what stops every reading taken during an unfinished
 * job from raising another identical ticket.
 */
export function dueMeterMaintenanceRules(
  asset: AssetLike,
  rules: MeterRule[],
  newValue: number,
  priorReadings: MeterReadingLike[],
  existingTickets: TicketLike[],
): MeterRule[] {
  const meterRules = rules.filter((r) => r.kind === "meter");
  if (meterRules.length === 0) return [];

  const readingsAsc = [...priorReadings].sort(
    (a, b) => ms(a.timestamp) - ms(b.timestamp),
  );
  const autoTickets = existingTickets.filter((t) => t.auto_generated === 1);

  return meterRules.filter((rule) => {
    const title = maintenanceRuleTitle(asset, rule);
    const matching = autoTickets
      .filter((t) => t.title === title)
      .sort((a, b) => ms(b.created_at) - ms(a.created_at));
    if (matching.some((t) => !t.resolved_at)) return false;

    const lastResolved = matching.find((t) => t.resolved_at);
    let baseline = readingsAsc[0]?.value ?? 0;
    if (lastResolved) {
      const resolvedAt = ms(lastResolved.created_at);
      const atOrAfter = readingsAsc.find((r) => ms(r.timestamp) >= resolvedAt);
      baseline = atOrAfter?.value ?? newValue;
    }
    return newValue - baseline >= rule.every;
  });
}
