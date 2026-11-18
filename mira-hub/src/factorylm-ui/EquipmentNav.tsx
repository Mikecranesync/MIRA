"use client";
/**
 * Equipment-first navigation in the Hub (Hub adapter, outside the frozen legacy trees):
 * the shared paged navigator over `/api/equipment-browser/*`. Behind MIRA_EQUIPMENT_NAV:
 * while the flag is off the routes answer 404 and this renders nothing.
 *
 * "Ask about" resolves the row on the server (exists, not retired, the revision on screen is
 * current) and hands the target to the host with where the press came from. The host acts only
 * if no conversation change happened since, and then opens the checklist on that component; the
 * technician selects it there (#5625 r2, Mike's B). This panel never writes a selection.
 *
 * Resolve carries no selection precondition (#5625 r1 F1): #5602's check means "the selection
 * is still exactly this component", which a switch to another component can never satisfy. The
 * checklist's own write is the compare-and-set.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { itemKey, type BrowserItem, type EquipmentSource, type QuestionTarget } from "@factorylm/interaction";
import { EquipmentAskNoticeBar, PagedEquipmentNavigator, useEquipmentAsk } from "@factorylm/ui";
import { createHubEquipmentSource, equipmentNavAvailable } from "./equipment-source";
import type { PickOrigin } from "./hub-host-logic";

export function EquipmentNav({
  origin,
  target,
  notice,
  onPick,
}: {
  /** Where a press would come from now: the open conversation (null = HOME) and the navigation generation. */
  origin: PickOrigin;
  /** What the next question is about, for the "Target" mark. */
  target: QuestionTarget | null;
  /** Why the last Ask about did not open the checklist (it may be closed). */
  notice: string | null;
  onPick: (target: QuestionTarget, pressedIn: PickOrigin) => void;
}) {
  // Read at the moment of a press, so the latest origin and handler are used.
  const originRef = useRef(origin);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    originRef.current = origin;
    onPickRef.current = onPick;
  }, [origin, onPick]);

  // The conversation as it was when this resolve was sent (one resolve at a time).
  const pressedIn = useRef<PickOrigin>(origin);
  const source = useMemo<EquipmentSource>(() => {
    const hub = createHubEquipmentSource();
    return {
      ...hub,
      resolve: (request, options) => {
        pressedIn.current = originRef.current;
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

  const asker = useEquipmentAsk(source, (next) => {
    setOpen(false);
    onPickRef.current(next, pressedIn.current);
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
