import {
  expandedFor,
  findEntry,
  indexEquipment,
  placeOf,
  shortPlaceOf,
  repeatedTagIds,
  sameTarget,
  searchEquipment,
  targetFor,
  targetText,
  type EquipmentEntry,
  type EquipmentNode,
  type QuestionTarget,
} from "@factorylm/interaction";
import { useMemo, useState } from "react";
import { ChevronIcon, ClockIcon, FolderIcon, MachineIcon, SearchIcon } from "./icons";

export interface EquipmentNavigatorProps {
  readonly roots: readonly EquipmentNode[];
  /** What the next question is about. Owned by the host; browsing never changes it. */
  readonly target: QuestionTarget | null;
  /** The row being browsed (host-owned so the composer bar can name it). */
  readonly browsingId: string | null;
  readonly onBrowse: (id: string) => void;
  /** The ONLY way the target changes: an explicit "Ask about" on an askable row. */
  readonly onAskAbout: (target: QuestionTarget, entryId: string) => void;
  /** Recently targeted rows, most recent first. */
  readonly recentIds?: readonly string[];
}

/** The row id that is the current question target (component, else the machine). */
function targetRowId(target: QuestionTarget | null): string | null {
  return target ? target.componentId ?? target.machineId : null;
}

function LevelIcon({ node }: { readonly node: EquipmentNode }) {
  return node.level === "machine" || node.level === "component" || node.level === "assembly"
    ? <MachineIcon />
    : <FolderIcon />;
}

/**
 * Equipment-first navigation. Rows are compact (one line, label then muted
 * tag when it differs from the label, detail and PLC symbol). A tag that appears on more than one row also shows where the row is,
 * so two "VFD1"s are never confused. Search and recent items bypass the tree.
 *
 * Browsing (expand, focus, search) is local. The question target moves only
 * when the technician presses "Ask about" on the row they are browsing.
 */
export function EquipmentNavigator({ roots, target, browsingId, onBrowse, onAskAbout, recentIds = [] }: EquipmentNavigatorProps) {
  const entries = useMemo(() => indexEquipment(roots), [roots]);
  const repeated = useMemo(() => repeatedTagIds(entries), [entries]);
  const currentId = targetRowId(target);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => expandedFor(entries, currentId));
  const [query, setQuery] = useState("");
  const hits = searchEquipment(entries, query);
  const recent = recentIds.map((id) => findEntry(entries, id)).filter((e): e is EquipmentEntry => e !== undefined);

  const toggle = (id: string) => setExpanded((open) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  // Reaching a row from search or recent opens its ancestors, so the tree shows where it is.
  const reveal = (id: string) => {
    setExpanded((open) => new Set([...open, ...expandedFor(entries, id)]));
    onBrowse(id);
  };

  const askButton = (entry: EquipmentEntry) => {
    const rowTarget = targetFor(entry);
    if (!rowTarget || entry.node.id !== browsingId || sameTarget(rowTarget, target)) return null;
    return <button
      type="button"
      className="fl-equip__ask"
      onClick={() => onAskAbout(rowTarget, entry.node.id)}
    >Ask about {entry.node.label}</button>;
  };

  const rowMeta = (entry: EquipmentEntry, showPlace: boolean) => <>
    <span className="fl-equip__text">
      <span className="fl-equip__label">{entry.node.label}</span>
      {entry.node.tag && entry.node.tag !== entry.node.label ? <span className="fl-equip__detail fl-equip__tag">{entry.node.tag}</span> : null}
      {entry.node.detail ? <span className="fl-equip__detail">{entry.node.detail}</span> : null}
      {entry.node.plcSymbol ? <span className="fl-equip__detail fl-equip__plc">PLC out {entry.node.plcSymbol}</span> : null}
      {showPlace ? <span className="fl-equip__place" title={placeOf(entry)}>{shortPlaceOf(entry) || placeOf(entry)}</span> : null}
    </span>
    {entry.node.id === currentId ? <span className="fl-equip__target-mark">Target</span> : null}
    {entry.node.status ? <span className="fl-tree__status" data-status={entry.node.status} aria-label={`Status: ${entry.node.status}`} /> : null}
  </>;

  const rows = (nodes: readonly EquipmentNode[]) => <>
    {nodes.map((node) => {
      const entry = findEntry(entries, node.id)!;
      const hasChildren = Boolean(node.children?.length);
      const open = expanded.has(node.id);
      return <li key={node.id} role="none">
        <div className="fl-equip__line">
          <button
            type="button"
            role="treeitem"
            className="fl-tree__row fl-equip__row"
            data-level={node.level}
            data-equipment-id={node.id}
            data-browsing={node.id === browsingId ? "true" : undefined}
            data-target={node.id === currentId ? "true" : undefined}
            aria-expanded={hasChildren ? open : undefined}
            aria-selected={node.id === browsingId}
            onClick={() => { onBrowse(node.id); if (hasChildren) toggle(node.id); }}
          >
            <span className="fl-tree__disclosure" aria-hidden="true">
              {hasChildren ? <ChevronIcon className="fl-tree__chevron"/> : null}
            </span>
            <span className="fl-tree__icon" aria-hidden="true"><LevelIcon node={node} /></span>
            {rowMeta(entry, repeated.has(node.id))}
          </button>
          {askButton(entry)}
        </div>
        {hasChildren && open
          ? <ul className="fl-tree__children" role="group">{rows(node.children!)}</ul>
          : null}
      </li>;
    })}
  </>;

  const flatList = (list: readonly EquipmentEntry[], label: string, kind: "search" | "recent") =>
    <ul className="fl-tree fl-tree--flat" aria-label={label}>
      {list.map((entry) => <li key={`${kind}-${entry.node.id}`}>
        <div className="fl-equip__line">
          <button
            type="button"
            className="fl-tree__row fl-equip__row"
            data-level={entry.node.level}
            data-equipment-id={entry.node.id}
            data-browsing={entry.node.id === browsingId ? "true" : undefined}
            data-target={entry.node.id === currentId ? "true" : undefined}
            onClick={() => reveal(entry.node.id)}
          >
            <span className="fl-tree__icon" aria-hidden="true"><LevelIcon node={entry.node} /></span>
            {/* Off-tree rows always show their place: there is no tree around them to say it. */}
            {rowMeta(entry, true)}
          </button>
          {askButton(entry)}
        </div>
      </li>)}
    </ul>;

  return <div className="fl-equip">
    <label className="fl-shell__search">
      <SearchIcon className="fl-shell__nav-icon" />
      <input
        type="search"
        aria-label="Search equipment"
        placeholder="Search tag, name or model"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
    </label>

    {query.trim()
      ? <section className="fl-shell__nav-section" aria-labelledby="fl-equip-results">
        <h2 id="fl-equip-results" className="fl-shell__section-title">Results</h2>
        {hits.length ? flatList(hits, "Equipment search results", "search") : <p className="fl-shell__empty">No matches.</p>}
      </section>
      : <>
        {recent.length
          ? <section className="fl-shell__nav-section" aria-labelledby="fl-equip-recent">
            <h2 id="fl-equip-recent" className="fl-shell__section-title"><ClockIcon className="fl-shell__nav-icon" />Recent</h2>
            {flatList(recent, "Recent equipment", "recent")}
          </section>
          : null}
        <section className="fl-shell__nav-section" aria-labelledby="fl-equip-tree">
          <h2 id="fl-equip-tree" className="fl-shell__section-title">Equipment</h2>
          <ul className="fl-tree" role="tree" aria-label="Equipment">{rows(roots)}</ul>
        </section>
      </>}
  </div>;
}

export interface QuestionTargetBarProps {
  readonly target: QuestionTarget | null;
  /** The askable row being browsed, when it differs from the target. */
  readonly browsing: QuestionTarget | null;
  readonly onAskAbout: (target: QuestionTarget) => void;
  /** Open the equipment navigation to pick another target. */
  readonly onChange?: () => void;
}

/**
 * Sits directly above the composer: what the next question is about, in words.
 * When the technician is browsing other equipment it says so, and keeps saying
 * where the question will go until they press "Ask about".
 */
export function QuestionTargetBar({ target, browsing, onAskAbout, onChange }: QuestionTargetBarProps) {
  const differs = browsing !== null && !sameTarget(browsing, target);
  return <section className="fl-qtarget" aria-label="Question target" data-differs={differs ? "true" : undefined}>
    <p className="fl-qtarget__line">
      <span className="fl-qtarget__key">Asking about</span>
      {target
        ? <><strong className="fl-qtarget__value" data-testid="question-target">{targetText(target)}</strong>
          {target.location ? <span className="fl-qtarget__place">{target.location}</span> : null}</>
        : <strong className="fl-qtarget__value" data-testid="question-target">No equipment (general question)</strong>}
      {onChange ? <button type="button" className="fl-qtarget__change" onClick={onChange}>Change</button> : null}
    </p>
    {differs
      ? <p className="fl-qtarget__line fl-qtarget__browsing" role="status">
        <span>Browsing {targetText(browsing)}. Questions still go to {target ? targetText(target) : "no equipment"}.</span>
        <button type="button" className="fl-equip__ask" onClick={() => onAskAbout(browsing)}>Ask about {browsing.componentLabel ?? browsing.machineLabel}</button>
      </p>
      : null}
  </section>;
}
