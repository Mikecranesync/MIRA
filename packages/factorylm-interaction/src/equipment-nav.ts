/**
 * Equipment-first navigation: site > area > line/cell > machine > optional
 * assembly > component.
 *
 * Two facts are kept apart on purpose:
 * - where the technician is BROWSING (any row, expanded or focused), and
 * - what the next question is ABOUT (the question target).
 *
 * Browsing never changes the target. Only an explicit "Ask about X" does,
 * through `targetFor`. A question "about the selected component" that is
 * re-pointed without the technician seeing it is the defect this split exists
 * to prevent (tablet semantic-retry gap, 2026-11-15).
 *
 * Fixture-only in this slice: no paging and no backend shape. The paged
 * factory contract waits for typed contract v1.1 (#5518).
 */

export type EquipmentLevel = "site" | "area" | "line" | "cell" | "machine" | "assembly" | "component";

export interface EquipmentNode {
  readonly id: string;
  readonly level: EquipmentLevel;
  readonly label: string;
  /** Plant tag (e.g. "VFD1"). Tags repeat across lines; the label alone may not be unique. */
  readonly tag?: string;
  /** Model or short description, shown muted after the label. */
  readonly detail?: string;
  /** Machine state only. Never decorative. */
  readonly status?: "normal" | "attention" | "unknown";
  readonly children?: readonly EquipmentNode[];
}

export interface EquipmentEntry {
  readonly node: EquipmentNode;
  /** Root first, parent last. */
  readonly ancestors: readonly EquipmentNode[];
}

export interface QuestionTarget {
  readonly machineId: string;
  readonly machineLabel: string;
  /** null = the whole machine. */
  readonly componentId: string | null;
  readonly componentLabel: string | null;
  /** Where the machine sits, e.g. "Lake Wales › Garage › Bench line". */
  readonly location: string;
}

const ASKABLE: ReadonlySet<EquipmentLevel> = new Set(["machine", "assembly", "component"]);
const SEARCHABLE: ReadonlySet<EquipmentLevel> = new Set(["line", "cell", "machine", "assembly", "component"]);

/** Every node in tree order, each with its ancestor chain. */
export function indexEquipment(roots: readonly EquipmentNode[]): EquipmentEntry[] {
  const out: EquipmentEntry[] = [];
  const walk = (nodes: readonly EquipmentNode[], ancestors: readonly EquipmentNode[]) => {
    for (const node of nodes) {
      out.push({ node, ancestors });
      if (node.children?.length) walk(node.children, [...ancestors, node]);
    }
  };
  walk(roots, []);
  return out;
}

export function findEntry(entries: readonly EquipmentEntry[], id: string): EquipmentEntry | undefined {
  return entries.find((entry) => entry.node.id === id);
}

function owningMachine(entry: EquipmentEntry): EquipmentNode | undefined {
  if (entry.node.level === "machine") return entry.node;
  return [...entry.ancestors].reverse().find((node) => node.level === "machine");
}

/** Site › Area › Line path above the machine (or above the node when it has no machine). */
export function locationOf(entry: EquipmentEntry): string {
  const above: EquipmentNode[] = [];
  for (const node of entry.ancestors) {
    if (node.level === "machine") break;
    above.push(node);
  }
  return above.map((node) => node.label).join(" › ");
}

/** Full place of a row: location, then machine and assembly, excluding the row itself. */
export function placeOf(entry: EquipmentEntry): string {
  return entry.ancestors.map((node) => node.label).join(" › ");
}

/**
 * The part of a row's place that tells two same-tag rows apart: its line/cell
 * and machine (e.g. "Line 2 › Conveyor 2"). The full path goes in a tooltip.
 */
export function shortPlaceOf(entry: EquipmentEntry): string {
  return entry.ancestors
    .filter((node) => node.level === "line" || node.level === "cell" || node.level === "machine")
    .map((node) => node.label)
    .join(" › ");
}

function tagKey(node: EquipmentNode): string {
  return (node.tag ?? node.label).trim().toLowerCase();
}

/**
 * Ids of machine/assembly/component rows whose tag (or label) also appears on
 * another row. Those rows show where they are, so two "VFD1"s are never confused.
 */
export function repeatedTagIds(entries: readonly EquipmentEntry[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  const askable = entries.filter((entry) => ASKABLE.has(entry.node.level));
  for (const entry of askable) counts.set(tagKey(entry.node), (counts.get(tagKey(entry.node)) ?? 0) + 1);
  return new Set(askable.filter((entry) => (counts.get(tagKey(entry.node)) ?? 0) > 1).map((entry) => entry.node.id));
}

/** Search bypasses the tree: matches on label, tag or detail, each with its place. */
export function searchEquipment(entries: readonly EquipmentEntry[], query: string, limit = 20): EquipmentEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries
    .filter((entry) => SEARCHABLE.has(entry.node.level))
    .filter((entry) => [entry.node.label, entry.node.tag, entry.node.detail]
      .some((value) => value !== undefined && value.toLowerCase().includes(needle)))
    .slice(0, limit);
}

/** The target an explicit "Ask about" on this row produces; null when the row is not askable. */
export function targetFor(entry: EquipmentEntry): QuestionTarget | null {
  if (!ASKABLE.has(entry.node.level)) return null;
  const machine = owningMachine(entry);
  if (!machine) return null;
  const machineEntry: EquipmentEntry = entry.node.level === "machine"
    ? entry
    : { node: machine, ancestors: entry.ancestors.slice(0, entry.ancestors.indexOf(machine)) };
  const whole = entry.node.level === "machine";
  return {
    machineId: machine.id,
    machineLabel: machine.label,
    componentId: whole ? null : entry.node.id,
    componentLabel: whole ? null : entry.node.label,
    location: locationOf(machineEntry),
  };
}

export function sameTarget(left: QuestionTarget | null, right: QuestionTarget | null): boolean {
  if (left === null || right === null) return left === right;
  return left.machineId === right.machineId && left.componentId === right.componentId;
}

/** "VFD1 · AutomationDirect GS10 on GS10 bench" or "GS10 bench (whole machine)". */
export function targetText(target: QuestionTarget): string {
  return target.componentLabel
    ? `${target.componentLabel} on ${target.machineLabel}`
    : `${target.machineLabel} (whole machine)`;
}

/** Most recent first, no duplicates. */
export function pushRecent(recent: readonly string[], id: string, max = 5): string[] {
  return [id, ...recent.filter((existing) => existing !== id)].slice(0, max);
}

/** Rows to open so a given row is visible: its ancestors. */
export function expandedFor(entries: readonly EquipmentEntry[], id: string | null): Set<string> {
  const entry = id ? findEntry(entries, id) : undefined;
  return new Set(entry ? entry.ancestors.map((node) => node.id) : []);
}
