/**
 * Phone web Back closes the shell's open layer (#5069).
 *
 * The shell closes its top layer (citation sheet, drawer, inspector, attachment menu) on its own
 * `BACK_EVENT`; the native app raises that event from the hardware Back button. A browser has no
 * such event: opening a layer added no history entry, so Back left /v3 for whatever page came
 * before it (often /login). This keeps exactly one placeholder history entry while any layer is
 * open. Back pops it and is turned into `BACK_EVENT`; a layer closed some other way (its own
 * button, Escape, the scrim) consumes the placeholder so history does not fill with dead entries.
 * Web only: the native shell keeps its own Back handling.
 */
const MARK = "flLayerBack";

export type BackDeps = {
  readonly history: Pick<History, "state" | "pushState" | "replaceState" | "back">;
  /** The address bar now. */
  readonly currentUrl: () => string;
  readonly onPopState: (listener: () => void) => () => void;
  readonly raiseBack: () => void;
};

export type LayerBack = { sync(layerOpen: boolean): void; dispose(): void };

export function createLayerBack(deps: BackDeps): LayerBack {
  // Our placeholder is the current history entry. A reload keeps the entry (and its mark), so
  // start armed rather than push a second one under it.
  const current = deps.history.state as Record<string, unknown> | null;
  let armed = Boolean(current && typeof current === "object" && current[MARK]);
  // Pops we caused ourselves, each with the address to keep: the host rewrites the address in place
  // when a thread is picked (writeSearch -> replaceState), which can land on the placeholder just
  // before we pop it, so the pop would otherwise restore the previous thread's URL.
  const swallow: string[] = [];
  const unsubscribe = deps.onPopState(() => {
    const keep = swallow.shift();
    if (keep !== undefined) { deps.history.replaceState(deps.history.state, "", keep); return; }
    if (!armed) return; // ordinary navigation, not ours
    armed = false;
    deps.raiseBack(); // closes the top layer; sync() re-arms if another layer is still open
  });
  return {
    sync(layerOpen) {
      if (layerOpen && !armed) {
        const state = deps.history.state;
        deps.history.pushState({ ...(state && typeof state === "object" ? state : {}), [MARK]: true }, "");
        armed = true;
      } else if (!layerOpen && armed) {
        armed = false;
        swallow.push(deps.currentUrl());
        deps.history.back();
      }
    },
    dispose: unsubscribe,
  };
}
