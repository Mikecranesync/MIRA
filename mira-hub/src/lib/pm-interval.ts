/**
 * Shared PM-schedule interval math.
 *
 * `addInterval` advances a base date by (value, unit) and returns the next
 * due date. Used by both the meter-reset path (`/[id]/meter`) and the
 * mark-complete path (`/[id]/complete`) so the two stay in lockstep.
 *
 * Note: 'cycles' is a meter unit, not a calendar one, so it has no calendar
 * advance and falls through to the `days` default. That's intentional —
 * cycle-based PMs are driven by the meter endpoint, where next_due_at is not
 * the trigger.
 */
export function addInterval(base: Date, value: number, unit: string): Date {
  const d = new Date(base);
  switch (unit) {
    case "hours":  d.setHours(d.getHours() + value); break;
    case "days":   d.setDate(d.getDate() + value); break;
    case "weeks":  d.setDate(d.getDate() + value * 7); break;
    case "months": d.setMonth(d.getMonth() + value); break;
    case "years":  d.setFullYear(d.getFullYear() + value); break;
    default:       d.setDate(d.getDate() + value); break;
  }
  return d;
}
