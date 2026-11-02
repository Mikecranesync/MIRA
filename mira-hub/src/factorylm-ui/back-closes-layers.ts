/** React wiring for the history controller in ./layer-back-history (#5069). Web only. */
import { useEffect, useRef, useState } from "react";
import { BACK_EVENT, NAVIGATION_LAYER_QUERY, topLayer } from "@factorylm/ui";
import { createLayerBack, type LayerBack } from "./layer-back-history";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(NAVIGATION_LAYER_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NAVIGATION_LAYER_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** Mount once in the web host with the state the shell renders. */
export function useBackClosesLayers(state: Parameters<typeof topLayer>[0]): void {
  const narrow = useNarrow();
  // Keyed on WHICH layer is on top, not just "any": Back that closes a sheet above the open drawer
  // must re-arm for the drawer.
  const top = topLayer(state, narrow);
  const controller = useRef<LayerBack | null>(null);
  useEffect(() => {
    controller.current = createLayerBack({
      history: window.history,
      currentUrl: () => window.location.href,
      onPopState: (listener) => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); },
      raiseBack: () => document.dispatchEvent(new Event(BACK_EVENT, { cancelable: true })),
    });
    return () => { controller.current?.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { controller.current?.sync(top !== null); }, [top]);
}
