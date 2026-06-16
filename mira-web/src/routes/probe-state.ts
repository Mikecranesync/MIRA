// mira-web/src/routes/probe-state.ts
// GET /api/probe-state — service health summary for the public status page.
//
// Data source: /tmp/probe-state.jsonl (written by the external CRA-277 probe).
// Each line is a JSON object: { "service": "...", "status": "ok"|"fail", "ts": "ISO8601" }
// If the file doesn't exist or can't be read, every service returns status "unknown".

import { Hono } from "hono";
import { readFileSync } from "node:fs";

export const probeStateRoute = new Hono();

const PROBE_STATE_PATH = "/tmp/probe-state.jsonl";

const SERVICE_NAMES = [
  "factorylm.com",
  "app.factorylm.com",
  "mira-pipeline",
  "mira-hub",
  "atlas-cmms",
  "telegram-bot",
  "qr-scan",
  "photo-ingest",
  "stripe",
] as const;

type ServiceName = (typeof SERVICE_NAMES)[number];
type ServiceStatus = "ok" | "fail" | "unknown";

interface ProbeEntry {
  service: string;
  status: "ok" | "fail";
  ts: string;
}

interface ServiceState {
  name: ServiceName;
  status: ServiceStatus;
  lastCheck: string | null;
}

interface ProbeStateResponse {
  updated: string;
  services: ServiceState[];
}

function defaultServices(): ServiceState[] {
  return SERVICE_NAMES.map((name) => ({
    name,
    status: "unknown" as ServiceStatus,
    lastCheck: null,
  }));
}

function readProbeState(): ServiceState[] {
  let raw: string;
  try {
    raw = readFileSync(PROBE_STATE_PATH, "utf8");
  } catch {
    // File doesn't exist or isn't readable — return all-unknown stub
    return defaultServices();
  }

  // Parse each line; ignore blank lines and malformed JSON
  const entries: ProbeEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as unknown;
      if (
        typeof obj === "object" &&
        obj !== null &&
        typeof (obj as Record<string, unknown>).service === "string" &&
        ((obj as Record<string, unknown>).status === "ok" ||
          (obj as Record<string, unknown>).status === "fail") &&
        typeof (obj as Record<string, unknown>).ts === "string"
      ) {
        entries.push(obj as ProbeEntry);
      }
    } catch {
      // Malformed line — skip silently
    }
  }

  // Keep only the last entry per service name
  const latestByService = new Map<string, ProbeEntry>();
  for (const entry of entries) {
    latestByService.set(entry.service, entry);
  }

  return SERVICE_NAMES.map((name) => {
    const entry = latestByService.get(name);
    if (!entry) {
      return { name, status: "unknown" as ServiceStatus, lastCheck: null };
    }
    return { name, status: entry.status, lastCheck: entry.ts };
  });
}

probeStateRoute.get("/", (c) => {
  const services = readProbeState();
  const response: ProbeStateResponse = {
    updated: new Date().toISOString(),
    services,
  };
  return c.json(response);
});
