"use client";
/**
 * Equipment-first navigation in the Hub (Hub adapter, outside the frozen legacy trees):
 * the shared paged navigator over `/api/equipment-browser/*`. Behind MIRA_EQUIPMENT_NAV:
 * while the flag is off the routes answer 404 and this renders nothing.
 *
 * "Ask about" resolves the row on the server (exists, not retired, the revision on screen is
 * current) and hands the target to the host with what the open conversation looked like at the
 * press. The host routes it only if that conversation is still open, and the checklist writes
 * the selection checked against that version and revision. This panel never writes a selection.
 *
 * Resolve carries no selection precondition (#5625 r1 F1): #5602's check means "the selection
 * is still exactly this component", which a switch to another component can never satisfy. The
 * version check is the checklist write's own compare-and-set.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { itemKey, type BrowserItem, type EquipmentSource, type QuestionTarget } from "@factorylm/interaction";
import { EquipmentAskNoticeBar, PagedEquipmentNavigator, useEquipmentAsk } from "@factorylm/ui";
import { createHubEquipmentSource, equipmentNavAvailable } from "./equipment-source";
import type { PickOrigin } from "./hub-host-logic";

export function EquipmentNav({
  conversation,
  target,
  notice,
  onPick,
}: {
  /** The open conversation (null = HOME) and its checklist's selection version ("unknown" until it reports). */
  conversation: PickOrigin;
  /** What the next question is about, for the "Target" mark. */
  target: QuestionTarget | null;
  /** How the last pick ended, when it did not select (the checklist may be closed). */
  notice: string | null;
  onPick: (target: QuestionTarget, seen: { origin: PickOrigin; revision: number | null }) => void;
}) {
  // Read at the moment of a press, so the latest conversation and handler are used.
  const conversationRef = useRef(conversation);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    conversationRef.current = conversation;
    onPickRef.current = onPick;
  }, [conversation, onPick]);

  // The conversation as it was when this resolve was sent (one resolve at a time).
  const pressedIn = useRef<PickOrigin>(null);
  const source = useMemo<EquipmentSource>(() => {
    const hub = createHubEquipmentSource();
    return {
      ...hub,
      resolve: (request, options) => {
        pressedIn.current = conversationRef.current;
        return hub.resolve(request, options);
      },
    };
  }, []);
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<BrowserItem | null>(null);

  useEffect(() => {
    let alive = true;
    void equipmentNavAvailable().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const asker = useEquipmentAsk(source, (next, item) => {
    setOpen(false);
    onPickRef.current(next, { origin: pressedIn.current, revision: item.kind === "notebook_component" ? item.revision ?? null : null });
  }, { selection: () => null });

  if (!available) return null;
  return (
    <section className="fl-equip-panel" aria-label="Find equipment" data-testid="equipment-nav">
      <button type="button" className="fl-equip__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Close equipment" : "Find equipment"}
      </button>
      <EquipmentAskNoticeBar asker={asker} />
      {notice ? <p role="status" className="fl-equip__notice" data-testid="equipment-pick-notice">{notice}</p> : null}
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
