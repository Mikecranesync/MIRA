/**
 * #3990 Golden Conversation, "return to Android": the open thread must be
 * current when the app comes back to the foreground, without a relaunch or a
 * manual reopen — the technician may have continued it on web meanwhile.
 *
 * Platform first (commodity-before-custom): Capacitor's `appStateChange` is the
 * resume signal, the same one Workorders and the resume guard already use. The
 * callback goes through a ref so the listener always sees the CURRENT closure;
 * the subscription itself is made once per mount.
 */
import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";

export function useForegroundRefresh(onResume: () => void): void {
  const ref = useRef(onResume);
  ref.current = onResume;
  useEffect(() => {
    const sub = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) ref.current();
    });
    return () => {
      void sub.then((s) => s.remove());
    };
  }, []);
}
