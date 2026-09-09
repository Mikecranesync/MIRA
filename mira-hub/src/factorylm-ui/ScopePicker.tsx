"use client";

import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "@/lib/config";

/**
 * The scope picker — "what is this question about?"
 *
 * V3 shipped with a permanent badge reading `No machine — general` and no way
 * to change it, so the shell could only ever ask general questions. That is
 * the difference between a search box and the product: MIRA's value is a cited
 * answer about YOUR machine, and a technician standing at a faulted drive had
 * no way to say which drive.
 *
 * The two scopes are genuinely different code paths, and this routes between
 * them rather than blurring them:
 *
 *   general → POST /api/hub/ask            (JSON, hybrid corpus, no asset)
 *   machine → POST /api/assets/{id}/chat/  (SSE, asset-scoped RAG + KG + live)
 *
 * Why not pass a machine to `/api/hub/ask`? Its system prompt says "NEVER
 * claim to know which machine they are standing at" — that route is general
 * BY CONTRACT. It does accept a `manufacturer` hint, and narrowing retrieval
 * to `Rockwell` would have been a one-line change that made the picker look
 * connected while the model still answered generically. A picker that binds a
 * machine in the UI and not in the answer is worse than no picker: the
 * technician reads a general answer as machine-specific, and answering about
 * the wrong machine is a safety problem.
 *
 * UNS gate: picking a machine here IS the confirmation. The chat-gate exists
 * because a Slack message doesn't know which machine the tech is looking at
 * (`.claude/rules/uns-confirmation-gate.md`); a Hub surface where the user
 * explicitly selected the row is a direct connection carrying its own identity
 * (`.claude/rules/direct-connection-uns-certified.md` — "Component-template
 * card / asset detail page ... the row the user opened"). So the asset path
 * must NOT then ask "are you sure you're looking at CV-101?".
 *
 * Read-only. The picker selects; it never writes asset state.
 */

export type Machine = {
  id: string;
  /** Where the machine sits in the Unified Namespace. Non-empty by construction:
   *  a row without one never becomes a Machine (see `partitionMachines`). */
  unsPath: string;
  tag: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
};

/** `null` is the general scope — deliberately not a sentinel machine, so a
 *  missing/failed selection can never be mistaken for a real asset. */
export type Scope = Machine | null;

/**
 * The ONE identity string. Every other scope-derived string is built from it,
 * so no two surfaces can disagree about which machine is bound.
 *
 * `tag` is non-optional on `Machine` but nothing guarantees it is non-EMPTY,
 * and an empty one used to diverge: the badge rendered " — Infeed conveyor"
 * while the chip hint rendered "". Falling back to the name here means every
 * consumer degrades identically, because they all read this.
 */
export function scopeIdentity(scope: Scope): string {
  if (!scope) return "General question";
  return scope.tag.trim() || scope.name.trim() || "This machine";
}

/** What the badge says. Identity first — it is the safety-relevant half, and
 *  it is what survives when the badge is ellipsed on a narrow screen. */
export function scopeLabel(scope: Scope): string {
  if (!scope) return "No machine — general";
  const id = scopeIdentity(scope);
  const name = scope.name.trim();
  return name && name !== id ? `${id} — ${name}` : id;
}

/** The composer's sub-line. It states the CONSEQUENCE of the current scope,
 *  not just its name: a technician needs to know whether the answer they are
 *  about to read is about their machine. */
export function scopeHint(scope: Scope): string {
  return scope
    ? `Answering about ${scopeIdentity(scope)}. Its manuals and history are in scope.`
    : "General question · pick a machine to ask about it specifically";
}

const GENERAL_SUGGESTIONS = [
  "What does fault F0004 mean on a PowerFlex 525?",
  "A conveyor is grinding under load — what should I check first?",
  "How do I reset a Siemens G120 after an overcurrent trip?",
];

/**
 * Machine-scoped starters.
 *
 * Deliberately question SHAPES, not invented specifics: MIRA knows nothing
 * about this machine until it retrieves, so a suggestion naming a fault code
 * or a part number would be a fabrication printed by the UI itself.
 */
const MACHINE_SUGGESTIONS = [
  "What faults has this machine had before?",
  "It stopped unexpectedly — what should I check first?",
  "Walk me through starting this machine safely.",
];

/**
 * Starter chips, with the hint read from `scopeIdentity` — NOT re-derived.
 *
 * This lived in `page.tsx` and computed `scope ? scope.tag : "General
 * question"` itself, making it a FOURTH place that decided what the current
 * scope is called, out of sight of the other three. Peer review found that the
 * four already disagreed on reachable input. Moving it here leaves one place
 * to get it wrong instead of four.
 */
export function suggestionsFor(scope: Scope): { q: string; hint: string }[] {
  const hint = scopeIdentity(scope);
  return (scope ? MACHINE_SUGGESTIONS : GENERAL_SUGGESTIONS).map((q) => ({ q, hint }));
}

/**
 * The endpoint a question goes to. Exported because this is the whole point of
 * the picker, and a regression here is silent: a machine-scoped question sent
 * to the general route still returns a plausible answer.
 */
export function askEndpointFor(scope: Scope): string {
  return scope ? `${API_BASE}/api/assets/${scope.id}/chat/` : `${API_BASE}/api/hub/ask`;
}

/**
 * The ROUTING identity of a scope — the key a conversation is partitioned by.
 *
 * Deliberately NOT `scopeIdentity`, which returns a display string (tag, then
 * name, then a fallback) and can therefore collide across two machines or
 * change when a machine is renamed. This keys on the same `scope.id` that
 * `askEndpointFor` routes on, and lives beside it so the endpoint a turn was
 * sent to and the bucket it is remembered in cannot drift apart.
 *
 * Why it exists: history is per-scope. Sending machine A's turns to machine
 * B's endpoint lets A's fault history shape an answer presented as grounded
 * for B — the identity boundary `.claude/rules/direct-connection-uns-certified.md`
 * exists to hold. Found by adversarial review (F1) on PR #3683.
 */
export function scopeKey(scope: Scope): string {
  return scope ? `asset:${scope.id}` : "general";
}

/** Substring match over the fields a technician would actually type: the tag
 *  on the machine, its name, its maker, its model, where it is. */
export function filterMachines(machines: Machine[], query: string): Machine[] {
  const q = query.trim().toLowerCase();
  if (!q) return machines;
  return machines.filter((m) =>
    [m.tag, m.name, m.manufacturer, m.model, m.location]
      .filter(Boolean)
      .some((f) => String(f).toLowerCase().includes(q)),
  );
}

type AssetRow = {
  id?: unknown;
  unsPath?: unknown;
  tag?: unknown;
  name?: unknown;
  manufacturer?: unknown;
  model?: unknown;
  location?: unknown;
};

/**
 * Project `/api/assets` rows onto the picker's shape, keeping only machines the
 * picker is allowed to offer.
 *
 * Two kinds of row are excluded, for two different reasons:
 *
 *  - No id → DROPPED and COUNTED as `malformed`. A row you cannot route to is a
 *    dead option — picking it would send the question to `/api/assets/undefined/chat/`
 *    — but it is not an "unplaced asset", it is a broken API response, so it
 *    must not inflate that count. It is counted separately so that an `/api/assets`
 *    regression on `id` (rename, dropped projection) is distinguishable from a
 *    tenant who genuinely owns no assets: an empty picker must be able to say
 *    which of those it is (round-4 review, #3683).
 *  - No UNS path → excluded and COUNTED as `unplaced`. Binding a question to a
 *    machine is a direct connection, and a direct connection must carry a
 *    resolvable UNS identifier or refuse — it may not proceed and ask later
 *    (.claude/rules/direct-connection-uns-certified.md). A machine nobody has
 *    placed in the namespace is therefore not a scope, however real it is in
 *    the CMMS. The count exists so the sheet can SAY why those machines are
 *    missing instead of presenting a silently shorter list.
 *
 * A machine with no description falls back to its tag rather than an empty line.
 */
export function partitionMachines(rows: unknown): { machines: Machine[]; unplaced: number; malformed: number } {
  if (!Array.isArray(rows)) return { machines: [], unplaced: 0, malformed: 0 };
  const machines: Machine[] = [];
  let unplaced = 0;
  let malformed = 0;
  for (const raw of rows) {
    const r = (raw ?? {}) as AssetRow;
    const id = typeof r.id === "string" ? r.id : null;
    if (!id) {
      malformed += 1;
      continue;
    }
    const unsPath = typeof r.unsPath === "string" ? r.unsPath.trim() : "";
    if (!unsPath) {
      unplaced += 1;
      continue;
    }
    const tag = typeof r.tag === "string" && r.tag ? r.tag : id;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : tag;
    machines.push({
      id,
      unsPath,
      tag,
      name,
      manufacturer: typeof r.manufacturer === "string" ? r.manufacturer : null,
      model: typeof r.model === "string" ? r.model : null,
      location: typeof r.location === "string" ? r.location : null,
    });
  }
  if (malformed > 0) {
    // Loud in the console because this is the API misbehaving, not the data.
    console.warn(`[ScopePicker] /api/assets returned ${malformed} row(s) without a string id — dropped as unroutable`);
  }
  return { machines, unplaced, malformed };
}

/** The offerable machines only — `partitionMachines` without the count. */
export function toMachines(rows: unknown): Machine[] {
  return partitionMachines(rows).machines;
}

export default function ScopePicker({
  current,
  onPick,
  onClose,
}: {
  current: Scope;
  onPick: (scope: Scope) => void;
  onClose: () => void;
}) {
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [unplaced, setUnplaced] = useState(0);
  const [malformed, setMalformed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${API_BASE}/api/assets`, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // `/api/assets` returns a BARE array (route.ts: `rows.map(rowToAsset)`),
      // not an envelope. Verified against the route rather than assumed — an
      // envelope guess would yield an empty list and read as "no machines".
      .then((d) => {
        if (!live) return;
        const { machines: offerable, unplaced: excluded, malformed: broken } = partitionMachines(d);
        setMachines(offerable);
        setUnplaced(excluded);
        setMalformed(broken);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => filterMachines(machines ?? [], query), [machines, query]);

  return (
    <div className="v3-sheet" role="dialog" aria-modal="true" aria-label="Choose what to ask about">
      <div className="v3-sheet__head">
        <b>Ask about</b>
        <button className="v3-icon" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      {/* General is always available and always first. It is the one option
          that cannot fail to load, so a technician is never stranded by a
          machine list that didn't arrive. */}
      <nav className="v3-sheet__list">
        <button
          className="v3-item"
          aria-current={current === null ? "true" : undefined}
          onClick={() => { onPick(null); onClose(); }}
        >
          General question
          <small>Searches the shared library and your uploads</small>
        </button>
      </nav>

      <div className="v3-sheet__head v3-sheet__sub"><b>Your machines</b></div>

      {machines !== null && machines.length > 6 && (
        <input
          className="v3-sheet__filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by tag, name, maker…"
          aria-label="Filter machines"
        />
      )}

      {failed && (
        <p className="v3-sheet__note">
          Couldn&apos;t load your machines. You can still ask a general question.
        </p>
      )}
      {!failed && machines === null && <p className="v3-sheet__note">Loading…</p>}
      {/* Honest about what is NOT offered. A technician who sees fewer machines
          here than on the assets page should be told the reason, not left to
          suspect the list is broken. */}
      {machines !== null && unplaced > 0 && (
        <p className="v3-sheet__note">
          {unplaced === 1 ? "1 machine is not" : `${unplaced} machines are not`} placed in the
          namespace yet, so {unplaced === 1 ? "it" : "they"} cannot be asked about specifically.
        </p>
      )}
      {/* An empty list because the API returned rows the picker cannot route is a
          different fact from an empty register, and must not be shown as one. */}
      {machines !== null && malformed > 0 && (
        <p className="v3-sheet__note" role="status">
          The machine list came back with {malformed === 1 ? "an entry" : `${malformed} entries`} the app
          could not read. Try again; if it persists, the assets API is misbehaving.
        </p>
      )}
      {machines !== null && machines.length === 0 && malformed === 0 && (
        <p className="v3-sheet__note">
          No machines yet. Add one to ask about it specifically.
        </p>
      )}
      {machines !== null && machines.length > 0 && shown.length === 0 && (
        <p className="v3-sheet__note">No machine matches “{query}”.</p>
      )}

      <nav className="v3-sheet__list">
        {shown.map((m) => (
          <button
            key={m.id}
            className="v3-item"
            aria-current={current?.id === m.id ? "true" : undefined}
            onClick={() => { onPick(m); onClose(); }}
          >
            {m.tag}
            <small>{[m.name, m.manufacturer, m.model].filter(Boolean).join(" · ")}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
