"use client";
/**
 * Equipment-first navigation in the Hub (Hub adapter, outside the frozen legacy trees):
 * the shared paged navigator over `/api/equipment-browser/*`. Behind MIRA_EQUIPMENT_NAV:
 * while the flag is off the routes answer 404 and this renders nothing.
 *
 * "Ask about" resolves the row on the server (revision and, for the open conversation,
 * selection version checked) and hands the target to the host, which opens the notebook
 * and lets the checklist select the component. This panel never writes a selection.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { itemKey, type BrowserItem, type QuestionTarget, type SelectionPrecondition } from "@factorylm/interaction";
import { EquipmentAskNoticeBar, PagedEquipmentNavigator, useEquipmentAsk } from "@factorylm/ui";
import { createHubEquipmentSource, equipmentNavAvailable } from "./equipment-source";

export function EquipmentNav({
  conversation,
  target,
  onPick,
}: {
  /**
   * The open conversation and its checklist's selection version, once the checklist has
   * reported for it (`version` null = never selected). Null while it has not.
   */
  conversation: { notebookId: string; threadId: string; version: number | null } | null;
  /** What the next question is about, for the "Target" mark. */
  target: QuestionTarget | null;
  onPick: (target: QuestionTarget) => void;
}) {
  const source = useMemo(() => createHubEquipmentSource(), []);
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<BrowserItem | null>(null);
  // Read at the moment of a press, so the latest conversation and handler are used.
  const conversationRef = useRef(conversation);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    conversationRef.current = conversation;
    onPickRef.current = onPick;
  }, [conversation, onPick]);

  useEffect(() => {
    let alive = true;
    void equipmentNavAvailable().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  // A component of the open conversation's notebook carries that conversation's selection
  // version, so a pick made elsewhere in between is refused (409 selection_changed). Anything
  // else opens a fresh chat, and the checklist's own expected version guards the write.
  const asker = useEquipmentAsk(source, (next) => {
    setOpen(false);
    onPickRef.current(next);
  }, {
    selection: (item): SelectionPrecondition | null => {
      const c = conversationRef.current;
      if (!c || item.kind !== "notebook_component" || item.parent?.kind !== "notebook" || item.parent.id !== c.notebookId) return null;
      return { threadKey: c.threadId, version: c.version };
    },
  });

  if (!available) return null;
  return (
    <section className="fl-equip-panel" aria-label="Find equipment" data-testid="equipment-nav">
      <button type="button" className="fl-equip__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Close equipment" : "Find equipment"}
      </button>
      <EquipmentAskNoticeBar asker={asker} />
      {open ? (
        <PagedEquipmentNavigator
          source={source}
          target={target}
          browsingKey={browsing ? itemKey(browsing) : null}
          onBrowse={setBrowsing}
          asker={asker}
        />
      ) : null}
    </section>
  );
}
