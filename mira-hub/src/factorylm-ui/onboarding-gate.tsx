"use client";

/**
 * #4284 Codex F1 (r1 + r2): on staging the shell is the landing page, so it
 * makes the same onboarding decision `/feed` makes (#1901) — and, like
 * `/feed`, it withholds its interactive UI until that decision is known. An
 * unfinished tenant is sent to `/onboarding` before they can type anything that
 * the redirect would throw away; a completed, unknown or failed read releases
 * the shell (fail-safe).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/config";
import { shellOnboardingRedirect } from "./onboarding-skip";

export function OnboardingGate({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // A tenant that already has notebooks keeps its conversation (PRD §19.11).
    void shellOnboardingRedirect((path) => fetch(`${API_BASE}${path}`, { cache: "no-store" })).then((to) => {
      if (cancelled) return;
      if (to) router.replace(to); // stays withheld while navigating away
      else setReady(true);
    });
    return () => { cancelled = true; };
  }, [router]);
  if (!ready) return <p className="hub-shell-host__checking" role="status" aria-busy="true">Checking your setup…</p>;
  return <>{children}</>;
}
