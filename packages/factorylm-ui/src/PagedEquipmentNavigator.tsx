import {
  askabilityOf,
  branchesReducer,
  EMPTY_BRANCH,
  itemKey,
  parentKey,
  repeatedLabelKeys,
  resolveFailureText,
  targetKeyOf,
  type BrowserItem,
  type BrowserPage,
  type EquipmentSource,
  type QuestionTarget,
  type ResolveFailureReason,
} from "@factorylm/interaction";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChevronIcon, FolderIcon, MachineIcon, SearchIcon } from "./icons";

/** A refused "Ask about": shown to the technician, never retried by the UI. */
export interface EquipmentAskNotice {
  readonly itemKey: string;
  readonly reason: ResolveFailureReason;
  readonly text: string;
}

export interface EquipmentAskController {
  /** Key of the row whose resolve is in flight, if any. */
  readonly pendingKey: string | null;
  readonly notice: EquipmentAskNotice | null;
  /** One explicit resolve. On success the host's onAskAbout runs; on refusal a notice is set. */
  readonly ask: (item: BrowserItem) => void;
  readonly dismiss: () => void;
}

/**
 * The only path from a paged row to a question target. One request per press;
 * a 409 (stale revision, changed selection) or any other refusal becomes a
 * notice and the target is left exactly as it was.
 */
export function useEquipmentAsk(
  source: EquipmentSource,
  onAskAbout: (target: QuestionTarget, item: BrowserItem) => void,
): EquipmentAskController {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<EquipmentAskNotice | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const onAskRef = useRef(onAskAbout);
  onAskRef.current = onAskAbout;
  useEffect(() => () => inFlight.current?.abort(), []);

  const ask = useCallback((item: BrowserItem) => {
    if (inFlight.current) return; // one resolve at a time; a second press does not queue a retry
    const key = itemKey(item);
    const askability = askabilityOf(item);
    if (askability !== "askable") {
      setNotice({ itemKey: key, reason: askability === "retired" ? "retired" : "no_link", text: resolveFailureText(askability === "retired" ? "retired" : "no_link", item.label) });
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    setPendingKey(key);
    setNotice(null);
    source.resolve({ kind: item.kind, id: item.id }, { signal: controller.signal })
      .catch(() => ({ ok: false as const, reason: "error" as const }))
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) onAskRef.current(result.target, item);
        else setNotice({ itemKey: key, reason: result.reason, text: resolveFailureText(result.reason, item.label) });
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
        if (!controller.signal.aborted) setPendingKey(null);
      });
  }, [source]);

  return { pendingKey, notice, ask, dismiss: () => setNotice(null) };
}

export interface PagedEquipmentNavigatorProps {
  readonly source: EquipmentSource;
  /** What the next question is about. Owned by the host; browsing never changes it. */
  readonly target: QuestionTarget | null;
  /** Key (kind:id) of the row being browsed; host-owned so the composer bar can name it. */
  readonly browsingKey: string | null;
  readonly onBrowse: (item: BrowserItem) => void;
  /** From `useEquipmentAsk`: the single resolve path, shared with the composer bar. */
  readonly asker: EquipmentAskController;
  /** Wait after typing before searching the server. */
  readonly searchDelayMs?: number;
}

function LevelIcon({ item }: { readonly item: BrowserItem }) {
  return item.kind === "namespace" ? <FolderIcon /> : <MachineIcon />;
}

const NOTE: Partial<Record<ReturnType<typeof askabilityOf>, string>> = {
  no_link: "Not linked to a notebook",
  retired: "Retired",
};

/**
 * Equipment-first navigation over a paged source. Children load when a row is
 * opened, "Show more" follows the server cursor, and search runs on the server.
 * The client holds only the pages it has been shown, never a plant-wide tree.
 */
export function PagedEquipmentNavigator({ source, target, browsingKey, onBrowse, asker, searchDelayMs = 250 }: PagedEquipmentNavigatorProps) {
  const [branches, dispatch] = useReducer(branchesReducer, new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searchFor, setSearchFor] = useState("");
  const requests = useRef(0);
  const aborts = useRef(new Map<string, AbortController>());
  const currentKey = targetKeyOf(target);

  const load = useCallback((key: string, run: (signal: AbortSignal, cursor: string | null) => Promise<BrowserPage>, cursor: string | null) => {
    aborts.current.get(key)?.abort();
    const controller = new AbortController();
    aborts.current.set(key, controller);
    const request = ++requests.current;
    const append = cursor !== null;
    dispatch({ type: "start", key, request, append });
    run(controller.signal, cursor).then(
      (page) => { if (!controller.signal.aborted) dispatch({ type: "page", key, request, page, append }); },
      () => { if (!controller.signal.aborted) dispatch({ type: "fail", key, request }); },
    );
  }, []);

  const loadChildren = useCallback((item: BrowserItem | null, cursor: string | null = null) => {
    const ref = item ? { kind: item.kind, id: item.id } : null;
    load(parentKey(ref), (signal, after) => source.children(ref, { cursor: after, signal }), cursor);
  }, [load, source]);

  useEffect(() => {
    loadChildren(null);
    const pending = aborts.current;
    return () => { for (const controller of pending.values()) controller.abort(); };
  }, [loadChildren]);

  // Debounced server search; clearing the box drops the results.
  useEffect(() => {
    const needle = query.trim();
    if (!needle) { setSearchFor(""); aborts.current.get("search")?.abort(); dispatch({ type: "reset", key: "search" }); return; }
    const timer = setTimeout(() => setSearchFor(needle), searchDelayMs);
    return () => clearTimeout(timer);
  }, [query, searchDelayMs]);
  useEffect(() => {
    if (!searchFor) return;
    load("search", (signal, cursor) => source.search(searchFor, null, { cursor, signal }), null);
  }, [searchFor, load, source]);

  const loaded = useMemo(() => [...branches.values()].flatMap((branch) => branch.items), [branches]);
  const repeated = useMemo(() => repeatedLabelKeys(loaded), [loaded]);

  const toggle = (item: BrowserItem) => {
    const key = itemKey(item);
    const opening = !expanded.has(key);
    setExpanded((open) => {
      const next = new Set(open);
      if (opening) next.add(key); else next.delete(key);
      return next;
    });
    const branch = branches.get(key);
    if (opening && (!branch || branch.status === "idle" || branch.status === "error")) loadChildren(item);
  };

  const askButton = (item: BrowserItem) => {
    const key = itemKey(item);
    if (key !== browsingKey || askabilityOf(item) !== "askable" || key === currentKey) return null;
    const pending = asker.pendingKey === key;
    return <button
      type="button"
      className="fl-equip__ask"
      disabled={asker.pendingKey !== null}
      aria-busy={pending ? "true" : undefined}
      onClick={() => asker.ask(item)}
    >{pending ? `Checking ${item.label}…` : `Ask about ${item.label}`}</button>;
  };

  const rowMeta = (item: BrowserItem, showPlace: boolean) => {
    const note = NOTE[askabilityOf(item)];
    return <>
      <span className="fl-equip__text">
        <span className="fl-equip__label">{item.label}</span>
        {item.tag && item.tag !== item.label ? <span className="fl-equip__detail fl-equip__tag">{item.tag}</span> : null}
        {item.detail ? <span className="fl-equip__detail">{item.detail}</span> : null}
        {note ? <span className="fl-equip__detail fl-equip__note" data-note={askabilityOf(item)}>{note}</span> : null}
        {showPlace && item.place ? <span className="fl-equip__place" title={item.place}>{item.place}</span> : null}
      </span>
      {itemKey(item) === currentKey ? <span className="fl-equip__target-mark">Target</span> : null}
    </>;
  };

  const branchFooter = (key: string, onMore: () => void, label: string) => {
    const branch = branches.get(key) ?? EMPTY_BRANCH;
    if (branch.status === "loading") return <li role="none" className="fl-equip__state" aria-live="polite">Loading…</li>;
    if (branch.status === "error") {
      return <li role="none" className="fl-equip__state" data-state="error">
        <span role="alert">Could not load {label}.</span>
        <button type="button" className="fl-equip__more" onClick={onMore}>Try loading again</button>
      </li>;
    }
    if (branch.hasMore) {
      const remaining = Math.max(branch.total - branch.items.length, 0);
      return <li role="none" className="fl-equip__state">
        <button type="button" className="fl-equip__more" onClick={onMore}>Show more{remaining ? ` (${remaining} more)` : ""}</button>
      </li>;
    }
    return null;
  };

  const rows = (parent: BrowserItem | null) => {
    const key = parentKey(parent);
    const branch = branches.get(key) ?? EMPTY_BRANCH;
    // After a failed first page the cursor is still null (reload); after a failed "Show more" it is the page that failed.
    const retry = () => loadChildren(parent, branch.nextCursor);
    return <>
      {branch.items.map((item) => {
        const k = itemKey(item);
        const hasChildren = item.childCount > 0;
        const open = expanded.has(k);
        return <li key={k} role="none">
          <div className="fl-equip__line">
            <button
              type="button"
              role="treeitem"
              className="fl-tree__row fl-equip__row"
              data-kind={item.kind}
              data-equipment-key={k}
              data-browsing={k === browsingKey ? "true" : undefined}
              data-target={k === currentKey ? "true" : undefined}
              aria-expanded={hasChildren ? open : undefined}
              aria-selected={k === browsingKey}
              onClick={() => { onBrowse(item); if (hasChildren) toggle(item); }}
            >
              <span className="fl-tree__disclosure" aria-hidden="true">
                {hasChildren ? <ChevronIcon className="fl-tree__chevron"/> : null}
              </span>
              <span className="fl-tree__icon" aria-hidden="true"><LevelIcon item={item} /></span>
              {rowMeta(item, repeated.has(k))}
            </button>
            {askButton(item)}
          </div>
          {hasChildren && open
            ? <ul className="fl-tree__children" role="group">{rows(item)}</ul>
            : null}
        </li>;
      })}
      {branchFooter(key, retry, parent ? `the contents of ${parent.label}` : "equipment")}
    </>;
  };

  const search = branches.get("search") ?? EMPTY_BRANCH;
  const searching = query.trim() !== "";

  return <div className="fl-equip" data-mode="paged">
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

    {asker.notice
      ? <div className="fl-equip__notice" data-reason={asker.notice.reason}>
        <p>{asker.notice.text}</p>
        <button type="button" className="fl-equip__more" onClick={asker.dismiss}>Dismiss</button>
      </div>
      : null}

    {searching
      ? <section className="fl-shell__nav-section" aria-labelledby="fl-equip-results">
        <h2 id="fl-equip-results" className="fl-shell__section-title">Results</h2>
        {search.status === "ready" && search.items.length === 0
          ? <p className="fl-shell__empty">No matches.</p>
          : <ul className="fl-tree fl-tree--flat" aria-label="Equipment search results">
            {search.items.map((item) => {
              const k = itemKey(item);
              return <li key={`search-${k}`}>
                <div className="fl-equip__line">
                  <button
                    type="button"
                    className="fl-tree__row fl-equip__row"
                    data-kind={item.kind}
                    data-equipment-key={k}
                    data-browsing={k === browsingKey ? "true" : undefined}
                    data-target={k === currentKey ? "true" : undefined}
                    onClick={() => onBrowse(item)}
                  >
                    <span className="fl-tree__icon" aria-hidden="true"><LevelIcon item={item} /></span>
                    {/* Off-tree rows always show their place: there is no tree around them to say it. */}
                    {rowMeta(item, true)}
                  </button>
                  {askButton(item)}
                </div>
              </li>;
            })}
            {branchFooter("search", () => load("search", (signal, cursor) => source.search(searchFor, null, { cursor, signal }), search.nextCursor), "search results")}
          </ul>}
      </section>
      : <section className="fl-shell__nav-section" aria-labelledby="fl-equip-tree">
        <h2 id="fl-equip-tree" className="fl-shell__section-title">Equipment</h2>
        <ul className="fl-tree" role="tree" aria-label="Equipment">{rows(null)}</ul>
      </section>}
  </div>;
}

/** The ask notice beside the composer, where the question target is read. */
export function EquipmentAskNoticeBar({ asker }: { readonly asker: EquipmentAskController }) {
  if (!asker.notice) return null;
  return <div className="fl-equip__notice" role="alert" data-reason={asker.notice.reason}>
    <p>{asker.notice.text}</p>
    <button type="button" className="fl-equip__more" onClick={asker.dismiss}>Dismiss</button>
  </div>;
}

/** Display-only target for the composer bar while browsing; asking still goes through `asker.ask`. */
export function provisionalTarget(item: BrowserItem | null): QuestionTarget | null {
  if (!item || askabilityOf(item) !== "askable") return null;
  if (item.kind === "notebook") return { machineId: item.id, machineLabel: item.label, componentId: null, componentLabel: null, location: item.place ?? "" };
  const machineLabel = item.place?.split(" › ").at(-1) ?? "";
  return { machineId: item.parent?.id ?? "", machineLabel, componentId: item.id, componentLabel: item.label, location: item.place ?? "" };
}

