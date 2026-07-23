# Knowledge Graph & Unified Namespace API

The Unified Namespace (UNS) is MIRA's canonical address space. Every asset, component, OEM manual, fault code, and PLC tag is a **node** identified by an `enterprise.*` ltree path. Relationships between nodes are evidence-backed and flow through a `proposed → verified` lifecycle that requires explicit admin or technician sign-off. Nothing is auto-verified.

This is MIRA's core differentiator: a live, evidence-grounded knowledge graph that connects physical hardware to its documentation, fault history, and live tag data — addressed by a path, not an opaque UUID.

**UNS path format:** `enterprise.{site}.{area}.{line}.{machine}` — all segments are lowercase slugs (non-alphanumeric runs collapsed to `_`). Example: `enterprise.north_plant.assembly.line_3.drive_motor`.

---

## Data models

```ts
type UnsNode = {
  id: string;                      // uuid — kg_entities row
  unsPath: string;                 // enterprise.* ltree, e.g. "enterprise.north_plant.line_3.cv_101"
  kind: "asset" | "component" | "manual" | "fault_code" | "plc_tag" | "pm_schedule" | "parts_list";
  name: string;                    // human-readable display name
  approvalState: "proposed" | "verified" | "rejected" | "needs_review";
  tenantId: string;                // uuid — scoped
  metadata?: Record<string, unknown>;
  createdAt: string;               // ISO 8601
  updatedAt: string;
};

type EvidenceItem = {
  sourceType: "manual" | "work_order" | "technician_confirmation" | "plc_tag_map" | "photo";
  sourceId: string;                // document id, work-order id, or session id
  pageRef?: string;                // "p.34 §4.2" when source is a manual
  confidence: "low" | "medium" | "high";
  extractedAt: string;
};

type KgRelationship = {
  id: string;                      // uuid — kg_relationships row
  sourceId: string;                // UnsNode id
  targetId: string;                // UnsNode id
  relationshipType: string;        // e.g. "has_component", "triggers_fault", "references_manual"
  approvalState: "proposed" | "verified" | "rejected" | "needs_review";
  evidence: EvidenceItem[];        // always present; at least one item required
  confidence: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
};

// AISuggestion = one row in ai_suggestions. This is what /kg/proposals returns
// and what "N proposals pending" in the Hub counts. Six suggestion_type values.
type AISuggestion = {
  id: string;                      // uuid
  suggestionType: "kg_entity" | "kg_edge" | "fault_mapping" | "pm_interval" | "component_profile" | "manual_gap";
  payload: Record<string, unknown>; // type-specific fields (see below)
  status: "pending" | "approved" | "rejected" | "needs_review";
  confidence: "low" | "medium" | "high";
  generatedBy: string;             // "engine" | "ingest" | "component_profile_builder"
  createdAt: string;
};

// RelationshipProposal = one row in relationship_proposals + 1..N relationship_evidence rows.
// Backs an AISuggestion of suggestionType="kg_edge" only.
// User-facing surfaces read AISuggestion, never relationship_proposals directly.
type RelationshipProposal = {
  id: string;
  aiSuggestionId: string;          // FK → ai_suggestions
  sourceUnsPath: string;
  targetUnsPath: string;
  relationshipType: string;
  evidence: EvidenceItem[];        // rows from relationship_evidence
  status: "pending" | "approved" | "rejected";
};

type NamespaceReadiness = {
  unsPath: string;
  score: number;                   // 0–100
  level: "none" | "partial" | "ready" | "approved";
  checks: {
    hasManual: boolean;
    hasFaultCodes: boolean;
    hasVerifiedRelationships: boolean;
    hasValidationQuestions: boolean;
    hasApprovedCitedAnswers: boolean;
  };
  pendingProposals: number;        // count of ai_suggestions with status="pending"
  updatedAt: string;
};
```

---

## Endpoints

### Get the UNS tree

```http
GET /api/v1/namespace/tree
```

Returns the full enterprise namespace as a nested tree, one level per UNS segment. Nodes include their `approvalState` so the Hub can highlight un-verified branches.

Query parameters:

| Name | Type | Description |
|---|---|---|
| `root` | string | Subtree root, e.g. `enterprise.north_plant`. Defaults to `enterprise`. |
| `depth` | int | Max depth to expand. Default 5, max 10. |
| `kind` | string | Filter leaf kind(s), comma-separated: `asset,component,fault_code`. |
| `approvalState` | string | `proposed,verified,rejected,needs_review` — comma-separated. |
| `limit` | int | Max leaf nodes. Default 200, max 2000. |
| `cursor` | string | Pagination cursor. |

Response:

```json
{
  "root": "enterprise",
  "items": [
    {
      "unsPath": "enterprise.north_plant",
      "kind": "asset",
      "name": "North Plant",
      "approvalState": "verified",
      "children": [
        {
          "unsPath": "enterprise.north_plant.assembly.line_3",
          "kind": "asset",
          "name": "Assembly Line 3",
          "approvalState": "verified",
          "children": [
            {
              "unsPath": "enterprise.north_plant.assembly.line_3.drive_motor",
              "kind": "component",
              "name": "Drive Motor",
              "approvalState": "proposed",
              "children": []
            }
          ]
        }
      ]
    }
  ],
  "nextCursor": null
}
```

### Get one node

```http
GET /api/v1/namespace/nodes/{unsPath}
```

`{unsPath}` is dot-separated, e.g. `enterprise.north_plant.assembly.line_3.drive_motor`.

Returns the full `UnsNode` plus its outgoing relationships (caller-side only; use `/kg/relationships` to query both directions).

Response:

```json
{
  "id": "kg_01HN...",
  "unsPath": "enterprise.north_plant.assembly.line_3.drive_motor",
  "kind": "component",
  "name": "Drive Motor",
  "approvalState": "verified",
  "metadata": { "manufacturer": "Baldor", "model": "CM3558T", "hp": 5 },
  "relationships": [
    {
      "id": "rel_01HP...",
      "relationshipType": "references_manual",
      "targetId": "kg_01HQ...",
      "approvalState": "verified",
      "confidence": "high",
      "evidence": [
        { "sourceType": "manual", "sourceId": "doc_01HR...", "pageRef": "p.12", "confidence": "high", "extractedAt": "2026-06-01T08:00:00Z" }
      ]
    }
  ],
  "createdAt": "2026-05-20T14:32:00Z",
  "updatedAt": "2026-06-01T09:11:00Z"
}
```

Returns `404` with code `uns_node_not_found` when the path does not exist in this tenant.

### List KG entities

```http
GET /api/v1/kg/entities
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `kind` | string | Filter by node kind. |
| `approvalState` | string | Comma-separated states. |
| `search` | string | Full-text over name and UNS path. |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Pagination cursor. |

### List KG relationships

```http
GET /api/v1/kg/relationships
```

Query parameters:

| Name | Type | Description |
|---|---|---|
| `sourceId` | string | Filter by source node id. |
| `targetId` | string | Filter by target node id. |
| `relationshipType` | string | e.g. `has_component`, `triggers_fault`. |
| `approvalState` | string | Comma-separated states. |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Pagination cursor. |

### List pending AI suggestions

```http
GET /api/v1/kg/proposals
```

Returns rows from `ai_suggestions` — these are the items the Hub's "N proposals pending" count reflects. Each item is an `AISuggestion`. For suggestions of `suggestionType="kg_edge"`, the `payload` includes the backing `RelationshipProposal` (sourced from `relationship_proposals` + `relationship_evidence`). User-facing surfaces always read `ai_suggestions`; they never query `relationship_proposals` directly.

Query parameters:

| Name | Type | Description |
|---|---|---|
| `status` | string | Default `pending`. Comma-separated: `pending,needs_review`. |
| `suggestionType` | string | One of: `kg_entity`, `kg_edge`, `fault_mapping`, `pm_interval`, `component_profile`, `manual_gap`. |
| `limit` | int | Default 50, max 200. |
| `cursor` | string | Pagination cursor. |

Response:

```json
{
  "items": [
    {
      "id": "sug_01HS...",
      "suggestionType": "kg_edge",
      "status": "pending",
      "confidence": "high",
      "generatedBy": "ingest",
      "payload": {
        "sourceUnsPath": "enterprise.north_plant.assembly.line_3.drive_motor",
        "targetUnsPath": "enterprise.knowledge_base.baldor.cm3558t.manual",
        "relationshipType": "references_manual",
        "relationshipProposal": {
          "id": "rp_01HT...",
          "evidence": [
            { "sourceType": "manual", "sourceId": "doc_01HR...", "pageRef": "p.12", "confidence": "high", "extractedAt": "2026-06-01T08:00:00Z" }
          ]
        }
      },
      "createdAt": "2026-06-01T08:05:00Z"
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

### Decide on an AI suggestion (admin only)

```http
POST /api/v1/kg/proposals/{id}/decide
```

**Requires write scope and admin role.** Promotion from `proposed` → `verified` is NEVER automatic. Every approval is an explicit human action. Code paths that call this endpoint without a real human decision are bugs.

This endpoint drives the status transition on `ai_suggestions`, and — for `suggestionType="kg_edge"` — on the backing row in `relationship_proposals` and the target rows in `kg_entities` / `kg_relationships`. All transitions follow ADR-0017; direct `UPDATE … SET status = …` on these tables is forbidden — all writes go through `proposal-transition`.

Body:

```json
{
  "decision": "approved",
  "note": "Confirmed against Baldor CM3558T installation guide p.12"
}
```

| Field | Required | Values |
|---|---|---|
| `decision` | yes | `approved` or `rejected` |
| `note` | no | Free-text reason, stored with the transition audit trail |

Response (200):

```json
{
  "id": "sug_01HS...",
  "status": "approved",
  "decidedBy": "user_01HU...",
  "decidedAt": "2026-06-15T11:42:00Z"
}
```

Returns `403 forbidden` with code `admin_required` for non-admin tokens. Returns `409 conflict` with code `already_decided` when the suggestion is not in a decidable state (`pending` or `needs_review`).

### Namespace readiness

```http
GET /api/v1/readiness
```

Returns the readiness score and level for every node in the namespace. Used by the Hub Command Center to indicate which assets are ready to deploy an approved agent vs. which still need documentation or validation.

Query parameters:

| Name | Type | Description |
|---|---|---|
| `unsPath` | string | Scope to a subtree root, e.g. `enterprise.north_plant`. |
| `level` | string | Filter by level: `none,partial,ready,approved`. |
| `limit` | int | Default 50, max 500. |
| `cursor` | string | Pagination cursor. |

Response:

```json
{
  "items": [
    {
      "unsPath": "enterprise.north_plant.assembly.line_3.drive_motor",
      "score": 72,
      "level": "partial",
      "checks": {
        "hasManual": true,
        "hasFaultCodes": true,
        "hasVerifiedRelationships": false,
        "hasValidationQuestions": false,
        "hasApprovedCitedAnswers": false
      },
      "pendingProposals": 3,
      "updatedAt": "2026-06-15T09:00:00Z"
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

To force a recalculation (e.g. after approving a batch of suggestions):

```http
POST /api/v1/readiness/recalculate
```

Body: `{ "unsPath": "enterprise.north_plant" }` — scopes recalculation to that subtree. Returns `202 Accepted`; the updated scores are available via `GET /api/v1/readiness` within a few seconds.

---

## Examples

### curl

```bash
# Browse the namespace from a site root
curl "https://acme.factorylm.com/api/v1/namespace/tree?root=enterprise.north_plant&depth=3" \
  -H "Authorization: Bearer $MIRA_KEY"

# See all pending AI suggestions for kg_edge type
curl "https://acme.factorylm.com/api/v1/kg/proposals?suggestionType=kg_edge&status=pending" \
  -H "Authorization: Bearer $MIRA_KEY"

# Admin approves a suggestion
curl -X POST "https://acme.factorylm.com/api/v1/kg/proposals/sug_01HS.../decide" \
  -H "Authorization: Bearer $MIRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved","note":"Confirmed vs. install guide p.12"}'
```

### TypeScript

```ts
import { MiraClient } from "@factorylm/mira-sdk";

const mira = new MiraClient({ tenant: "acme", apiKey: process.env.MIRA_KEY! });

// Walk the namespace tree from a site
const tree = await mira.namespace.tree({ root: "enterprise.north_plant", depth: 3 });
for (const node of tree.items) console.log(node.unsPath, node.approvalState);

// Fetch pending proposals and approve each (admin token required)
const pending = await mira.kg.proposals({ status: "pending" });
for (const suggestion of pending.items) {
  await mira.kg.decide(suggestion.id, { decision: "approved", note: "Batch approval after audit" });
}
```

### Python

```python
from mira import Mira
mira = Mira(tenant="acme", api_key=os.environ["MIRA_KEY"])

# Get readiness report for a site
for node in mira.readiness.list(uns_path="enterprise.north_plant"):
    print(node.uns_path, node.level, node.score)

# Resolve a specific node
node = mira.namespace.get("enterprise.north_plant.assembly.line_3.drive_motor")
print(node.approval_state, [r.relationship_type for r in node.relationships])
```

---

## Webhooks emitted

- `kg.proposal_created` — MIRA generated a new row in `ai_suggestions` (any `suggestionType`)
- `kg.proposal_decided` — an admin approved or rejected a row in `ai_suggestions`
- `kg.relationship_verified` — a `kg_relationships` row transitioned to `approvalState="verified"`
- `kg.entity_verified` — a `kg_entities` row transitioned to `approvalState="verified"`
- `namespace.readiness_changed` — a node's readiness `level` changed (e.g. `partial` → `ready`)

See [Webhooks API](./webhooks.md) to subscribe. All five events include the full resource payload so consumers can avoid a round-trip.
