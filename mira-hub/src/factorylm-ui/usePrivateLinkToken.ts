"use client";
import { useLayoutEffect, useRef, useState } from "react";
/** Fragments never enter HTTP request URIs or referrers. Capture once, then
 * remove from browser history before presenting/confirming the credential. */
export function usePrivateLinkToken(legacyQueryToken: string | null = null) {
    const captured = useRef(false);
    const [token, setToken] = useState<string | null>(null);
    useLayoutEffect(() => {
        if (captured.current)
            return;
        captured.current = true;
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const value = fragment.get("token") || legacyQueryToken;
        if (fragment.has("token"))
            window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setToken(value);
    }, [legacyQueryToken]);
    return token;
}
