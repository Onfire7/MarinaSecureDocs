// Shift report compilation (see docs: pages/shift-report.html,
// docs/architecture.md — Shift report delivery).
//
// Records aren't linked to a shift by reference; association is computed from
// timestamps falling inside the shift's start/end window (per docs/data-model.md
// — Shift). That is not a shortcut: a shift started on one device and walked on
// another has no id to carry, and the window is the only definition that
// survives it. An open shift's window runs to "now", so viewing mid-shift shows
// progress so far. This is the same compilation the send path performs, which
// is why viewing always reflects current data rather than an email snapshot.

export interface ShiftWindow {
  started_at: string | number;
  ended_at?: string | number | null;
}

export function shiftWindowMs(shift: ShiftWindow): { start: number; end: number } {
  return {
    start: new Date(shift.started_at).getTime(),
    end: shift.ended_at ? new Date(shift.ended_at).getTime() : Date.now(),
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
