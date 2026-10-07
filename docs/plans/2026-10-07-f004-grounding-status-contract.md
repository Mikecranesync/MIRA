# F004 grounding-status contract — document revision 4 (wire version 1)

**Status:** the server half (M1 + correction C1), both clients' display (M2) and the phone's explicit choice (M3) are **implemented on PR #4303**, not merged or deployed. The server flag is off and cannot yet be turned on (§7); with it off every client behaves exactly as before. This document authorizes no merge, deploy or flag change.
**Risk class:** R2 — a shared server contract on the notebook chat route. No migration, tenant-filter, provider, prompt or safety-policy change.

## 0. Document revision vs wire version

These are two different numbers. Don't confuse them.

| | What it is | Value |
|---|---|---|
| **Document revision** | Which edition of this text you are reading | **r3** (this file) |
| **Wire version** | The `v` field inside every stored/streamed entry, and the capability name a client declares | **`v: 1`**, capability **`grounding_status_v1`** |

Revision history:

- **r1** (`92135941d`): first proposal. It used the terms `validated` / `grounded`, a single `docIds` list and a `retrievalFailed` field. **None of that shipped**; r1's field list is obsolete.
- **r2**: delivered in the working session and approved by the owner as the basis for M1; never committed. Introduced capability negotiation, `outcome`, `manualCited`, "citation linked" and the fallback link.
- **r3**: r2 as actually implemented, plus correction C1 (shared-library references, reference-format validation, `droppedRefCount`).
- **r4** (this file): adds the client half (§8) and the request-id form of `fallbackOf` (§5). The wire shape is unchanged — still `v: 1`.

Wire version 1 is defined by **this** revision. No deployed server has ever written an entry (the flag is not plumbed into any container — §7), so the r1 shape never existed on the wire. Any future change that an existing `grounding_status_v1` client could misread must bump **both** `v` and the capability name; adding a field a v1 reader can ignore does not.

## 1. What F004 does and does not establish

The cause of the two observed F004 turns is **unresolved**. Three candidates remain open and none is proven:

- **B:** passages were retrieved, the model answered without citing them, and the turn was labelled general.
- **A2:** passages were retrieved, the model refused, and the phone silently re-asked in general mode.
- **A1:** the scope missed, zero passages came back, and the phone silently re-asked.

The per-turn rows and the staging `jev-shadow-report` for that window have not been read. This contract does not depend on which candidate it was: in all three, the server discarded *why* the turn ended. The contract records that reason. It does not improve retrieval, change which passages are found, or judge whether a passage supports a claim.

## 2. The entry (implemented)

One object per saved turn, built once by `buildGroundingStatus` in `mira-hub/src/capabilities/grounding-status.ts` (pure, deterministic, no inference). It is appended to the existing `equipment_notebook_turns.evidence` JSONB array — **no migration** (`evidence` has no CHECK). It contains ids, references and counts only: never chunk text, answer text, prompts, credentials or signed URLs.

```ts
interface GroundingStatusEntry {
  kind: "grounding_status";
  v: 1;
  outcome: GroundingOutcome;               // exactly one — §3
  retrieval: {
    status: "passages_found" | "no_passages" | "unavailable" | "not_attempted";
    notAttemptedReason?: "general_mode" | "no_manual_scope";   // only with not_attempted
    scopeDocIds: string[];        // server-validated notebook doc scope (UUIDs only)
    passageCount: number;         // passages that entered the prompt
    returnedDocIds: string[];     // notebook passages, by document UUID
    returnedSourceRefs: string[]; // shared-library passages, as "<origin+path>#p<page|?>"
  };
  citation: {
    status: "linked" | "uncited" | "refused" | "not_applicable";
    linkedDocIds: string[];       // filled only when status === "linked"
    linkedSourceRefs: string[];   // filled only when status === "linked"
    unresolvedMarkerCount: number;// [n] markers matching no retrieved passage (linked/uncited only, else 0)
  };
  manualCited: boolean;           // === (citation.status === "linked"); never set independently
  droppedRefCount: number;        // references dropped for bad format, across all three lists
  fallback: {
    offered: boolean;             // may a client offer "general guidance (not from the manual)"? — §5
    of?: string;                  // this general answer was requested from that failed turn — §5
  };
}
```

### Terminology

- **`manualCited` / citation `linked`:** at least one `[n]` marker in the shipped answer resolves to a passage retrieved **for this turn**. It does **not** mean the passage supports the sentence. Semantic support stays with the existing groundedness / JEV signals. Test T3b pins this limit: an irrelevant passage cited as `[1]` still reads `linked`.
- **`uncited`:** an answer was produced, passages were in the prompt, and no marker resolved. The answer is not manual-cited, whatever its `basis` label says.
- **`refused`:** the model's output matched the refusal verdict, or the pre-display answer gate withheld a non-unsafe answer.
- `basis` (migration 084) and `answer_status` (073) are **unchanged**. The entry adds a reason; it changes neither column.

### References (C1)

- **Notebook documents** are identified by document UUID. A non-UUID doc id is dropped and counted.
- **Shared-library (OEM) passages** have no notebook doc id. They are recorded as `<origin+path>#p<page>` — the evidence packet's convention — with `#p?` when the page is missing or not a non-negative integer. Only `http:`/`https:` URLs are accepted. Credentials, query string and fragment are stripped before storage. A reference longer than 512 characters, or any other format, is dropped and counted in `droppedRefCount`.
- Each list is de-duplicated and capped at 32 entries.
- **Format validation is not authorization.** What authorizes a reference is where it came from (§6): the scope is the server-validated list, passages come from tenant-scoped retrieval of that scope, and citations are built only from those passages. Before C1, a cited shared-library passage was recorded as `manualCited: true` with no linked reference; it is now kept in `linkedSourceRefs`.

## 3. Deterministic precedence (implemented — first matching row wins)

| # | Condition | `outcome` | `citation.status` | `fallback.offered` |
|---|---|---|---|---|
| 0 | Request rejected before a turn is saved (400/401/412, notebook-retrieval error, claim failure) | — no row, no entry — | — | — (§8 gap) |
| 1 | Terminal Safety STOP (`unsafe_answer`) | `safety_stop` | `not_applicable` | false, always |
| 2 | Technician stopped the answer | `stopped` | `not_applicable` | false (Retry is the action) |
| 3 | Provider called, nothing served | `provider_error` | `not_applicable` | false |
| 4 | Zero-evidence abstain (no model call), shared library unreachable | `abstained_retrieval_unavailable` | `not_applicable` | rule F |
| 5 | Zero-evidence abstain, otherwise | `abstained_no_passages` | `not_applicable` | rule F |
| 6 | Refused, passages in the prompt | `refused_with_passages` | `refused` | rule F |
| 7 | Refused, no passages | `refused_without_passages` | `refused` | rule F |
| 8 | Answered, ≥1 emitted citation | `answered_citation_linked` | `linked` | false |
| 9 | Answered, passages in the prompt, no emitted citation | `answered_uncited_with_passages` | `uncited` | rule F |
| 10 | Answered, no passages | `answered_without_manual` | `not_applicable` | false |

`retrieval.status` is computed independently of the outcome:

1. `not_attempted` when neither notebook nor shared-library retrieval ran — with `notAttemptedReason` `general_mode` (general mode) or `no_manual_scope` (anything else);
2. else `unavailable` when the shared-library lookup failed (this takes precedence over any passages that were found);
3. else `passages_found` when ≥1 passage entered the prompt;
4. else `no_passages`.

**Rule F:** `fallback.offered = !notebookBound && scopeDocIds.length > 0 && !general`, applied only on rows 4, 5, 6, 7 and 9. A notebook bound to a resolved machine keeps its abstention — an answer about that machine is grounded or it is not. The action is never offered after a safety stop, a stop or a provider error.

## 4. Capability negotiation (implemented)

The server flag `NOTEBOOK_GROUNDING_STATUS_ENABLED` is on only for `1` or `true` (trimmed, case-insensitive). Unset, empty, `0`, `false` and any other value are **off**.

| Flag | Request declares `grounding_status_v1`? | Entry saved | Live frame | History | Replay | Refusal status text |
|---|---|---|---|---|---|---|
| off | either | no | no | unchanged | unchanged | `Not found in the selected sources.` |
| on | no | **yes** | no | entry stripped | entry not re-emitted | `Not found in the selected sources.` |
| on | yes | yes | yes | entry kept | stored entry re-emitted | `I couldn't answer that from the selected sources.` |

- **How a client declares:** the chat POST body carries `clientCapabilities: ["grounding_status_v1"]` (a comma-separated string is also accepted); the notebook detail GET carries `?caps=grounding_status_v1`. Match is exact after trimming.
- **Older clients:** with the flag on and no declaration, live output, history and replay are byte-identical to flag-off (test T10). An installed phone build would otherwise render the unknown entry as an "Unrecognized part" box; the negotiation exists to prevent that.
- The zero-passage abstain wording is unchanged in every row.

## 5. Explicit general-guidance link (implemented server side)

- **Request:** `{ mode: "general", fallbackOf: "<failed turn id>", … }`. The id may be the failed turn's row id or the `clientRequestId` it was sent with (a phone holds only the latter for an answer it just received live; the stream never carries the row id).
- **Validated before** the request claim, retrieval or any model call, and only while the flag is on. The id must be a UUID and the request must be in general mode. `getFallbackSourceTurn` (`mira-hub/src/lib/equipment-notebooks.ts`) then requires, in SQL: the session's tenant, this notebook, this turn id, `owner_user_id` = the session user (strict — a legacy ownerless row does not qualify), the same thread (`IS NOT DISTINCT FROM`), and `client_request_state = 'complete'`. The stored entry on that turn must have `fallback.offered === true`.
- **Failure:** `400 {error:"fallback_of_invalid"}`; if the lookup itself errors, `503 {error:"fallback_check_failed"}`. Neither calls the model.
- **Success:** the new general turn's entry carries `fallback.of = <row id>` — the database row id the lookup returned, never the body string, whichever id the client sent. The original failed turn is not modified.
- **Flag off:** `fallbackOf` is ignored exactly as today — no lookup, no 400.

## 6. Live, history and replay (implemented)

- **One object.** The builder runs once per saved turn at each of the three save points: the zero-evidence abstain, the stopped answer, and the final answer (which also covers safety stop, provider error and refusal). That same object is persisted and, for a declaring client, streamed.
- **Live:** a `{kind:"grounding_status", …}` SSE frame immediately before the `status` frame, on the abstain path and the final path. A stopped turn is saved but gets no live frame (the client has disconnected).
- **History:** `GET /api/equipment-notebooks/[id]` strips the entry from every turn's `evidence` unless shown (§4).
- **Replay** (same `clientRequestId`): re-emits the **stored** entry, never a recomputed one, immediately before `status`, only for a declaring request. The replay request must repeat the original body, capability included, because the request claim is bound to the full body.
- **Legacy turns** (saved without an entry) list and replay exactly as before and are never shown as `manualCited` (T12).
- **Provenance of every id:**
  - scope ids — `validateChatSources` filters the requested ids by tenant and notebook; the request body is only an intersection request;
  - passages — `retrieveNodeChunks` with the session tenant and `approvedSourceDocIds` = that validated list;
  - citations — built only from those passages; emitted citations are the subset the answer actually used;
  - `fallback.of` — the id returned by the scoped database lookup.

  Route test T13 pins the first two: a request listing an extra valid-looking UUID and a junk id, with the server authorizing only one document, yields retrieval, live entry and saved entry that contain only the authorized id.

## 7. Enablement status (implemented code, not enabled)

The flag is **not plumbed**. The `mira-hub` services in `docker-compose.saas.yml` and `docker-compose.staging-vps.yml` use explicit `environment:` lists that do not include `NOTEBOOK_GROUNDING_STATUS_ENABLED`, so a Doppler value alone never reaches the container. Enabling anywhere first needs a reviewed Compose change. The capability record `notebook_grounding_status` in `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml` is `implemented_unconnected` and says so.

## 8. Clients (implemented on PR #4303, not deployed)

### M2 — the evidence status is shown

- **One reader.** `packages/factorylm-interaction/src/grounding-status.ts` turns a v1 entry into the shared `grounding_status` part; anything malformed or of another version is ignored, never shown raw. The Hub and the phone both use it.
- **One renderer.** `packages/factorylm-ui` renders one line about what the attempt did and never claims the manual lacks the answer:

  | outcome | line |
  |---|---|
  | `abstained_no_passages`, `refused_without_passages` (manual searched) | "The search didn't find a passage in the selected manual for this question. That doesn't mean the manual doesn't cover it." |
  | `refused_with_passages` | "MIRA read passages from the selected manual but couldn't answer from them. That doesn't mean the manual doesn't cover it." |
  | `abstained_retrieval_unavailable` | "The manual library couldn't be reached just now, so this wasn't checked against it. Try again in a moment." |
  | `answered_uncited_with_passages` | "This answer doesn't point to a passage in the selected manual. Treat it as general guidance." |
  | `answered_without_manual` with `fallback.of` | "General guidance — not from your manual." |
  | linked, plain general, stop, safety stop, provider error | no line (existing presentation already says it) |

- **Refusals are not "general guidance".** For refused and abstained outcomes the client drops the legacy `general_reasoning` basis chip; the server's `basis` column is unchanged.
- **Who declares it.** Hub `/v3`: every chat body and detail load. Phone: the unified shell only (the classic and ChatV2 surfaces would show the entry as a raw box, so they never declare it).
- **When it appears.** The Hub reloads saved turns right after each answer, so it renders from the saved row. The phone renders the live frame immediately and the saved row after reload; both map to the same part (tested through the phone's unchanged stream parser).

### M3 — explicit choice before general guidance

- The action "Get general guidance (not from the manual)" appears only where the server offered it (rule F, §3). It settles after one tap; after reload, an offer a later turn already used shows "General guidance was requested below."
- The tap re-asks the failed turn's **own question** as a new general turn with no sources and its own request id, linked by `fallbackOf` (saved turn: row id; phone live turn: the request id it was sent with — §5).
- The phone's #3862 silent re-ask no longer runs when the server sent its evidence status. **With the flag off it is unchanged** — the old behaviour is what "disabled" means here, and it stops only when the flag is turned on.
- Guarded legacy files changed: `mira-mobile/src/api/resources.ts` and `mira-mobile/src/screens/NotebookScreen.tsx` (lifecycle rationale + exact-head Codex GREEN before merge).

## 9. Recovery gaps and residuals (unresolved)

1. **Notebook-retrieval errors** and the **approved-context 412** save no turn, so there is no entry, nothing to replay and nothing to link a fallback to (T5 pins the retrieval-error behavior). A durable "attempt failed" row is a separate change.
2. **Refusals keep `basis: general_reasoning` in storage.** Clients that read the entry drop the misleading chip; any other reader of the column still sees `general_reasoning`.
3. **Old phone builds keep the silent re-ask** until a build with PR #4303 reaches them; so do new builds while the flag is off. OTA availability is not adoption; measure general-mode turns without `fallbackOf` that immediately follow an `insufficient_evidence` turn in the same thread.
4. **"Linked" is not "supports"** (T3b).
5. **F004's cause remains unknown** (§1).

## 10. Test evidence map (PR #4303)

| Behavior | Tests | Mutation controls |
|---|---|---|
| Precedence rows, `manualCited` derivation, rule F | unit B1–B4; route T1–T4b | M1–M4 |
| Retrieved but uncited stays uncited; unresolved markers counted | route T2, T3, T3c | M6 |
| Honest refusal wording only for declaring clients | route T4 + control | M16 |
| Live = saved = replay; stored, not recomputed | route T9, T4b, T6 | M10, M18, M19 |
| Older clients unchanged (live, history, replay) | route T10 | M7–M9 |
| Flag default off, and off for malformed values | unit flag tests; route T11 | M5, C1-M6, C1-M7 |
| `fallbackOf` scoped by session tenant/notebook/owner/thread, offered, general only | route T7 matrix; unit SQL-predicate test | M11–M15 |
| References typed, bounded, content-free, no credentials/signed URLs | unit B5 + C1 block | C1-M1…C1-M11 |
| Scope/retrieval ids are the server-validated list, not the request body | route T13 | P1–P3 |
| Notebook-retrieval error saves nothing (the gap stays visible) | route T5 | M17 |
| `fallbackOf` by request id resolves to the row id, owner/notebook/thread/complete only | real-Postgres integration (6); route T8c | owner, notebook, thread, pending, request-id |
| Status copy never claims the manual lacks the answer; action only where offered, once | ui `grounding-status.test.tsx` (17) | 6 |
| Hub declares + maps + links; refusal drops the general chip; used offer settles on reload | hub `to-interaction` / `hub-host-logic` tests | 6 |
| Hub client ↔ real route round trip (refusal → reload → tap → linked general → reload) | route "round trip" (2) | 2 |
| Phone: one ask then explicit tap; flag-off re-ask unchanged; bound notebook no action; reload links by row id | `mira-mobile/tests/unified-general-guidance.test.tsx` (6; 5 red on old code) | 5 |
| Phone live frame and saved row map to the same part | `grounding-status-live-sse.test.ts` | — |

Run: `cd mira-hub && ./node_modules/.bin/vitest run src/capabilities/__tests__/grounding-status.test.ts src/capabilities/__tests__/grounding-status-route.test.ts`
