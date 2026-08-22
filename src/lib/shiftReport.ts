// Shift report compilation (see docs: pages/shift-report.html,
// architecture.html — Shift report delivery).
//
// Records aren't linked to a Shift by reference; association is computed from
// timestamps falling inside the shift's start/end window (per data-model.html
// — Shift). An open shift's window runs to "now", so viewing mid-shift shows
// progress so far. This is the same compilation the send path performs, which
// is why viewing always reflects current data rather than an email snapshot.

export interface ShiftWindow {
  startedAt: string | number;
  endedAt?: string | number | null;
}

export function shiftWindowMs(shift: ShiftWindow): { start: number; end: number } {
  return {
    start: new Date(shift.startedAt).getTime(),
    end: shift.endedAt ? new Date(shift.endedAt).getTime() : Date.now(),
  };
}

export function withinWindow(
  timestamp: string | number | null | undefined,
  window: { start: number; end: number },
): boolean {
  if (timestamp == null) return false;
  const ts = new Date(timestamp).getTime();
  return ts >= window.start && ts <= window.end;
}

export function formatDuration(window: { start: number; end: number }): string {
  const totalMinutes = Math.max(0, Math.round((window.end - window.start) / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
