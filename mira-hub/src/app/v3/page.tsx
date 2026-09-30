"use client";
/**
 * /v3 — the shared FactoryLM shell on real Hub data (Hub mount PR 1, #3839).
 *
 * Temporary authenticated test/canary route for the unified shell, not a
 * product: `/feed` remains the default authenticated landing until the
 * charter's Gate 6 default-route switch. The classic notebook at
 * `(hub)/equipment/[id]` is untouched and remains the rollback path.
 *
 * Everything here is presentation: the host (`src/factorylm-ui/hub-host.tsx`)
 * talks to the existing routes only — notebooks, notebook detail, and the ONE
 * canonical conversation backend `POST /api/equipment-notebooks/[id]/chat`.
 */
import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import { HubShellHost } from "@/factorylm-ui/hub-host";

export default function V3Page() {
  return <HubShellHost />;
}
