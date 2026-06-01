"""MIRA MCP Server — equipment diagnostics + CMMS integration."""

import asyncio
import logging
import os
import sqlite3
import sys

import httpx as _httpx
from cmms.atlas import AtlasCMMS
from cmms.factory import create_cmms_adapter
from fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from tenant_resolver import resolve_atlas_creds

logger = logging.getLogger("mira-mcp")

DB_PATH = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
MCP_REST_API_KEY = os.environ.get("MCP_REST_API_KEY", "")
RETRIEVAL_BACKEND = os.environ.get("RETRIEVAL_BACKEND", "openwebui")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "")
PIPELINE_BASE_URL = os.environ.get("PIPELINE_BASE_URL", "http://mira-pipeline-saas:9099")
PIPELINE_API_KEY = os.environ.get("PIPELINE_API_KEY", "")
# HMAC key for Ignition WebDev chat authentication.  Never logged.
MIRA_IGNITION_HMAC_KEY = os.environ.get("MIRA_IGNITION_HMAC_KEY", "")

# Internal Atlas adapter — always-on for diagnostic case recording
_atlas_internal: AtlasCMMS | None = None
_atlas_tmp = AtlasCMMS()
if _atlas_tmp.configured:
    _atlas_internal = _atlas_tmp
    sys.stderr.write("INFO: Atlas internal store enabled for diagnostic recording\n")
else:
    sys.stderr.write(
        "WARNING: Atlas internal store not configured — diagnostic_record_case disabled\n"
    )
del _atlas_tmp

# External CMMS adapter — customer's CMMS (maintainx|limble|upkeep)
_cmms = create_cmms_adapter()
if _cmms is not None and not isinstance(_cmms, AtlasCMMS):
    sys.stderr.write(f"INFO: External CMMS integration enabled (provider={type(_cmms).__name__})\n")
elif _cmms is not None and isinstance(_cmms, AtlasCMMS):
    _cmms = None
    sys.stderr.write("INFO: CMMS_PROVIDER=atlas routed to internal store, external CMMS disabled\n")
else:
    sys.stderr.write("INFO: External CMMS integration disabled (CMMS_PROVIDER not set)\n")

_CMMS_DISABLED_ERROR = {"error": "CMMS not configured (set CMMS_PROVIDER)"}
_ATLAS_DISABLED_ERROR = {"error": "Internal diagnostic store not configured"}

_viking_ok = False
if RETRIEVAL_BACKEND == "openviking":
    try:
        from context.viking_store import retrieve as _viking_retrieve

        _viking_ok = True
        sys.stderr.write("INFO: OpenViking retrieval backend active\n")
    except Exception as _e:
        sys.stderr.write(f"WARNING: OpenViking import failed: {_e}\n")
if not MCP_REST_API_KEY:
    sys.stderr.write("ERROR: MCP_REST_API_KEY not set — REST :8001 will reject all requests\n")
    sys.stderr.flush()

# FastMCP v3: constructor takes only the server name/identity.
# Transport (host/port/SSE) is configured in run_http_async below.
# The former `description=` kwarg is dropped — metadata lives in tool docstrings.
mcp = FastMCP("mira-mcp")


def _ensure_schema():
    """Create required tables if they don't exist. Idempotent."""
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS equipment_status (
            equipment_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unknown',
            last_updated TEXT NOT NULL DEFAULT (datetime('now')),
            speed_rpm REAL,
            temperature_c REAL,
            current_amps REAL,
            pressure_psi REAL,
            metadata TEXT
        );
        CREATE TABLE IF NOT EXISTS faults (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipment_id TEXT NOT NULL,
            fault_code TEXT NOT NULL,
            description TEXT,
            severity TEXT NOT NULL DEFAULT 'warning',
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            resolved INTEGER NOT NULL DEFAULT 0,
            resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_faults_equipment ON faults(equipment_id);
        CREATE INDEX IF NOT EXISTS idx_faults_resolved ON faults(resolved);
        CREATE TABLE IF NOT EXISTS maintenance_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipment_id TEXT NOT NULL,
            note TEXT NOT NULL,
            author TEXT NOT NULL DEFAULT 'system',
            category TEXT NOT NULL DEFAULT 'general',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS conversation_state (
            chat_id TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'IDLE',
            context TEXT NOT NULL DEFAULT '{}',
            asset_identified TEXT,
            fault_category TEXT,
            exchange_count INTEGER NOT NULL DEFAULT 0,
            final_state TEXT,
            voice_enabled INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    db.close()
    sys.stderr.write(f"INFO: Schema ensured at {DB_PATH}\n")


_ensure_schema()


def _get_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    return db


def _equipment_type_from_name(filename: str) -> str:
    """Derive equipment_type slug from PDF filename.

    'gs10-vfd-manual.pdf' → 'gs10-vfd'
    Strips common doc-type suffixes so the result is an equipment identifier.
    """
    stem = os.path.splitext(filename)[0].lower()
    for suffix in (
        "-manual",
        "-guide",
        "-spec",
        "-datasheet",
        "-data-sheet",
        "_manual",
        "_guide",
        "_spec",
        "_datasheet",
        "_data_sheet",
    ):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem[:40] or "general"


@mcp.tool
def get_equipment_status(equipment_id: str = "") -> dict:
    """Get current status of equipment. Pass equipment_id to filter, or omit for all."""
    db = _get_db()
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    if equipment_id:
        cur.execute("SELECT * FROM equipment_status WHERE equipment_id = ?", (equipment_id,))
    else:
        cur.execute("SELECT * FROM equipment_status")
    rows = [dict(r) for r in cur.fetchall()]
    db.close()
    return {"equipment": rows}


@mcp.tool
def list_active_faults() -> dict:
    """List all currently active faults across all equipment."""
    db = _get_db()
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    cur.execute("SELECT * FROM faults WHERE resolved = 0 ORDER BY timestamp DESC")
    rows = [dict(r) for r in cur.fetchall()]
    db.close()
    return {"active_faults": rows}


@mcp.tool
def get_fault_history(equipment_id: str = "", limit: int = 50) -> dict:
    """Get fault history. Optionally filter by equipment_id. Returns most recent first."""
    db = _get_db()
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    if equipment_id:
        cur.execute(
            "SELECT * FROM faults WHERE equipment_id = ? ORDER BY timestamp DESC LIMIT ?",
            (equipment_id, limit),
        )
    else:
        cur.execute("SELECT * FROM faults ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    db.close()

    # OpenViking augmentation — appended context, never replaces SQLite results
    context_chunks = []
    if _viking_ok and MIRA_TENANT_ID:
        query = f"{equipment_id} fault history" if equipment_id else "fault history equipment"
        try:
            context_chunks = _viking_retrieve(query, MIRA_TENANT_ID, top_k=3)
        except Exception as _e:
            sys.stderr.write(f"WARNING: viking_retrieve failed: {_e}\n")

    return {"fault_history": rows, "viking_context": context_chunks}


@mcp.tool
def get_maintenance_notes(
    equipment_id: str = "", category: str = "", limit: int = 50
) -> list[dict]:
    """Get maintenance notes for equipment. Filter by equipment_id and/or category."""
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    try:
        query = "SELECT * FROM maintenance_notes WHERE 1=1"
        params = []
        if equipment_id:
            query += " AND equipment_id = ?"
            params.append(equipment_id)
        if category:
            query += " AND category = ?"
            params.append(category)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── Diagnostic Case Recording (always-on, writes to internal Atlas store) ──


@mcp.tool
async def diagnostic_record_case(
    title: str,
    description: str,
    priority: str = "MEDIUM",
    asset_id: int = 0,
    category: str = "CORRECTIVE",
) -> dict:
    """Record a diagnostic case in MIRA's internal store. Always available.

    Args:
        title: Short summary (e.g. 'VFD overcurrent fault on Pump-001')
        description: Full diagnostic context from MIRA session
        priority: NONE, LOW, MEDIUM, HIGH
        asset_id: Internal asset ID (0 to skip)
        category: CORRECTIVE, PREVENTIVE, CONDITION_BASED, EMERGENCY
    """
    if _atlas_internal is None:
        return _ATLAS_DISABLED_ERROR
    return await _atlas_internal.create_work_order(
        title,
        description,
        priority,
        asset_id=str(asset_id) if asset_id else None,
        category=category,
    )


# ── External CMMS Tools (write to customer's MaintainX/Limble/UpKeep) ──


@mcp.tool
async def cmms_write_work_order(
    title: str,
    description: str,
    priority: str = "MEDIUM",
    asset_id: int = 0,
    category: str = "CORRECTIVE",
) -> dict:
    """Write a work order to the customer's external CMMS (MaintainX, Limble, UpKeep).

    Args:
        title: Short summary (e.g. 'VFD overcurrent fault on Pump-001')
        description: Full diagnostic context from MIRA session
        priority: NONE, LOW, MEDIUM, HIGH
        asset_id: CMMS asset ID (0 to skip)
        category: CORRECTIVE, PREVENTIVE, CONDITION_BASED, EMERGENCY
    """
    if _cmms is None:
        return {
            "error": "No external CMMS configured. Set CMMS_PROVIDER to maintainx, limble, or upkeep."
        }
    return await _cmms.create_work_order(
        title,
        description,
        priority,
        asset_id=str(asset_id) if asset_id else None,
        category=category,
    )


@mcp.tool
async def cmms_create_work_order(
    title: str,
    description: str,
    priority: str = "MEDIUM",
    asset_id: int = 0,
    category: str = "CORRECTIVE",
) -> dict:
    """Create a work order from a diagnostic finding. Routes to internal store or external CMMS.

    Args:
        title: Short summary (e.g. 'VFD overcurrent fault on Pump-001')
        description: Full diagnostic context from MIRA session
        priority: NONE, LOW, MEDIUM, HIGH
        asset_id: CMMS asset ID (0 to skip)
        category: CORRECTIVE, PREVENTIVE, CONDITION_BASED, EMERGENCY
    """
    if _cmms is not None:
        return await cmms_write_work_order(title, description, priority, asset_id, category)
    return await diagnostic_record_case(title, description, priority, asset_id, category)


@mcp.tool
async def cmms_list_work_orders(status: str = "", limit: int = 20) -> dict:
    """List work orders. Uses external CMMS if configured, otherwise internal store."""
    adapter = _cmms or _atlas_internal
    if adapter is None:
        return _CMMS_DISABLED_ERROR
    orders = await adapter.list_work_orders(status, limit)
    return {"work_orders": orders, "count": len(orders)}


@mcp.tool
async def cmms_complete_work_order(work_order_id: int, feedback: str = "") -> dict:
    """Mark a work order as complete. Uses external CMMS if configured, otherwise internal store."""
    adapter = _cmms or _atlas_internal
    if adapter is None:
        return _CMMS_DISABLED_ERROR
    return await adapter.complete_work_order(str(work_order_id), feedback)


@mcp.tool
async def cmms_list_assets(limit: int = 50) -> dict:
    """List equipment assets. Uses external CMMS if configured, otherwise internal store."""
    adapter = _cmms or _atlas_internal
    if adapter is None:
        return _CMMS_DISABLED_ERROR
    assets = await adapter.list_assets(limit)
    return {"assets": assets, "count": len(assets)}


@mcp.tool
async def cmms_get_asset(asset_id: int) -> dict:
    """Get details for a specific asset. Uses external CMMS if configured, otherwise internal store."""
    adapter = _cmms or _atlas_internal
    if adapter is None:
        return _CMMS_DISABLED_ERROR
    return await adapter.get_asset(str(asset_id))


@mcp.tool
async def cmms_list_pm_schedules(asset_id: int = 0, limit: int = 20) -> dict:
    """List preventive maintenance schedules. Uses external CMMS if configured, otherwise internal store."""
    adapter = _cmms or _atlas_internal
    if adapter is None:
        return _CMMS_DISABLED_ERROR
    schedules = await adapter.list_pm_schedules(
        asset_id=str(asset_id) if asset_id else None,
        limit=limit,
    )
    return {"pm_schedules": schedules, "count": len(schedules)}


@mcp.tool
async def cmms_health() -> dict:
    """Check CMMS API connectivity. Reports both internal and external status."""
    result = {}
    if _atlas_internal is not None:
        result["internal"] = await _atlas_internal.health_check()
    else:
        result["internal"] = {"status": "disabled"}
    if _cmms is not None:
        result["external"] = await _cmms.health_check()
    else:
        result["external"] = {"status": "disabled", "info": "No external CMMS configured"}
    return result


@mcp.tool
async def create_asset_from_nameplate(
    tenant_id: str,
    manufacturer: str,
    model: str,
    serial: str = "",
    voltage: str = "",
    hp: str = "",
    fla: str = "",
) -> dict:
    """Create an Atlas CMMS asset for a tenant from extracted nameplate fields.

    Resolves the tenant's Atlas credentials from NeonDB, then POSTs a new
    asset scoped to that tenant's CMMS account. Called after a nameplate
    photo is processed by the vision pipeline.

    Args:
        tenant_id: PLG tenant UUID (plg_tenants.id).
        manufacturer: Equipment manufacturer name (e.g. 'Allen-Bradley').
        model: Model number from nameplate (e.g. '1336 PLUS II').
        serial: Serial number (optional).
        voltage: Nameplate voltage rating (optional, e.g. '460V').
        hp: Horsepower rating (optional, e.g. '25HP').
        fla: Full load amps (optional, e.g. '32A').
    """
    creds = await resolve_atlas_creds(tenant_id)
    if not creds:
        return {"error": f"Tenant {tenant_id} not provisioned in Atlas"}

    email, password, api_url = creds
    atlas = AtlasCMMS.for_tenant(email, password, api_url)

    description_parts = []
    if serial:
        description_parts.append(f"Serial: {serial}")
    if voltage:
        description_parts.append(f"Voltage: {voltage}")
    if hp:
        description_parts.append(f"HP: {hp}")
    if fla:
        description_parts.append(f"FLA: {fla}")
    description = ", ".join(description_parts) if description_parts else ""

    return await atlas.create_asset(
        name=f"{manufacturer} {model}".strip(),
        description=description,
        manufacturer=manufacturer,
        model=model,
        serial=serial,
    )


OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text:latest")


async def _rest_embed(request):
    """POST /api/embed — embed text via Ollama. Returns 768-dim vector."""
    body = await request.json()
    text = body.get("text", "")
    if not text:
        return JSONResponse({"error": "missing 'text' field"}, status_code=400)
    texts = body.get("texts")
    if texts and isinstance(texts, list):
        results = []
        for t in texts[:50]:
            try:
                resp = await _httpx.AsyncClient(timeout=30).post(
                    f"{OLLAMA_URL}/api/embeddings",
                    json={"model": EMBED_MODEL, "prompt": t},
                )
                resp.raise_for_status()
                results.append(resp.json()["embedding"])
            except Exception:
                results.append(None)
        return JSONResponse({"embeddings": results})
    try:
        async with _httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text},
            )
            resp.raise_for_status()
            return JSONResponse({"embedding": resp.json()["embedding"]})
    except Exception as exc:
        sys.stderr.write(f"ERROR: /api/embed failed: {exc}\n")
        return JSONResponse({"error": f"Embedding failed: {exc}"}, status_code=502)


async def _rest_ingest_pdf(request):
    """POST /ingest/pdf — receive a PDF, save it, index into viking store."""
    from context.viking_store import ingest_pdf as _ingest_pdf

    try:
        form = await request.form()
        file_field = form.get("file")
        if file_field is None:
            return JSONResponse({"error": "missing 'file' field"}, status_code=400)
        equipment_type = form.get("equipment_type") or _equipment_type_from_name(
            getattr(file_field, "filename", "") or "upload.pdf"
        )
        filename = getattr(file_field, "filename", None) or "upload.pdf"
        pdf_bytes = await file_field.read()

        save_dir = os.path.join(os.path.dirname(DB_PATH), "pdfs")
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, filename)
        with open(save_path, "wb") as fh:
            fh.write(pdf_bytes)

        form_tenant_raw = form.get("tenant_id")
        form_tenant = form_tenant_raw.strip() if isinstance(form_tenant_raw, str) else ""
        if form_tenant:
            tenant_id, tenant_source = form_tenant, "form"
        elif MIRA_TENANT_ID:
            tenant_id, tenant_source = MIRA_TENANT_ID, "env"
        else:
            tenant_id, tenant_source = "default", "default"

        chunks = _ingest_pdf(save_path, tenant_id, equipment_type)
        sys.stderr.write(
            f"INFO: Ingested {chunks} chunks from {filename} "
            f"(type={equipment_type}, tenant={tenant_id}, tenant_source={tenant_source})\n"
        )
        return JSONResponse(
            {
                "status": "ok",
                "filename": filename,
                "chunks": chunks,
                "equipment_type": equipment_type,
            }
        )
    except Exception as exc:
        sys.stderr.write(f"ERROR: /ingest/pdf failed: {exc}\n")
        return JSONResponse({"error": str(exc)}, status_code=500)


# ── Agent Invocation Tools ────────────────────────────────────────────────────


def _pipeline_headers() -> dict:
    h = {"Content-Type": "application/json"}
    if PIPELINE_API_KEY:
        h["Authorization"] = f"Bearer {PIPELINE_API_KEY}"
    return h


@mcp.tool
async def run_kb_builder() -> dict:
    """Run the KB Builder agent to detect under-covered manufacturers and trigger documentation crawls.

    Queries NeonDB for manufacturers with fewer than 5 KB chunks, then fires crawl jobs
    for the top 3 gaps. Returns an AgentRunReport with detected/succeeded/failed counts.
    Typical runtime: 1-5 seconds (crawls are async fire-and-forget).
    """
    try:
        async with _httpx.AsyncClient(timeout=320) as client:
            resp = await client.post(
                f"{PIPELINE_BASE_URL}/api/agents/run/kb_builder",
                headers=_pipeline_headers(),
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        return {"error": str(exc), "agent": "kb_builder"}


@mcp.tool
async def run_prompt_optimizer() -> dict:
    """Run the Prompt Optimizer agent to detect eval failure clusters and propose prompt improvements.

    Reads the latest eval scorecard, finds checkpoints failing >=2 times, asks Groq to suggest
    a fix, and writes a candidate.yaml. NEVER auto-promotes — always escalates for human review.
    Returns an AgentRunReport. If no failures are found, returns detected=0 (nothing to do).
    """
    try:
        async with _httpx.AsyncClient(timeout=320) as client:
            resp = await client.post(
                f"{PIPELINE_BASE_URL}/api/agents/run/prompt_optimizer",
                headers=_pipeline_headers(),
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        return {"error": str(exc), "agent": "prompt_optimizer"}


@mcp.tool
async def run_infra_guardian() -> dict:
    """Run the Infrastructure Guardian agent to check VPS service health and auto-restart failures.

    Hits health endpoints for mira-pipeline, mira-ingest, mira-core, and mira-mcp.
    Restarts any unhealthy containers via docker compose and verifies recovery.
    Returns an AgentRunReport. If all services are healthy, returns detected=0.
    """
    try:
        async with _httpx.AsyncClient(timeout=320) as client:
            resp = await client.post(
                f"{PIPELINE_BASE_URL}/api/agents/run/infra_guardian",
                headers=_pipeline_headers(),
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        return {"error": str(exc), "agent": "infra_guardian"}


@mcp.tool
async def get_agent_status() -> dict:
    """Get the current status and recent run history for all autonomous MIRA agents.

    Returns a summary for kb_builder, prompt_optimizer, and infra_guardian including:
    last run timestamp, duration, detected/succeeded/failed/escalated counts, total_runs,
    and the last 10 run records for sparkline display.
    """
    try:
        async with _httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{PIPELINE_BASE_URL}/api/agents/public-status",
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        return {"error": str(exc)}


# ── KG multi-hop tools (Phase 5 of #806) ──────────────────────────────────
# Thin proxies to mira-hub's /api/internal/kg dispatch. Hub owns the database;
# these tools just expose the multi-hop API to MCP clients (Open WebUI,
# external agents, Claude Desktop). All require INTERNAL_KG_API_KEY.


@mcp.tool
def kg_maintenance_context(
    tenant_id: str,
    equipment_entity_id: str = "",
    uns_path: str = "",
    include_similar: bool = False,
    fault_window_days: int = 90,
) -> dict:
    """Aggregated maintenance context for one piece of equipment.

    Pass `equipment_entity_id` (kg_entities.id UUID) OR `uns_path` (ltree
    address, e.g. `enterprise.stardust_racers.site.garage_factory.area.
    conveyor_lab.line.line1.work_cell.conveyor_cell.equipment.conveyor_b16`).
    The hub resolves the path to a kg_entities row.

    Returns hierarchy (plant/area/line), components, recent faults (with
    counts in window), recent work orders, parts, manuals, PM schedule,
    optional similar equipment, and plan-vs-actual mismatches. Use this
    before answering any question about a specific asset.
    """
    from kg_client import KgClientError, maintenance_context

    if not equipment_entity_id and not uns_path:
        return {"ok": False, "error": "pass equipment_entity_id or uns_path"}

    try:
        return {
            "ok": True,
            "result": maintenance_context(
                tenant_id,
                equipment_entity_id,
                uns_path=uns_path or None,
                include_similar=include_similar,
                fault_window_days=fault_window_days,
            ),
        }
    except KgClientError as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def kg_impact_analysis(tenant_id: str, entity_id: str) -> dict:
    """Walk `feeds` forward from this entity and return downstream nodes,
    blocked lines, and partially-impacted lines (those with an alternate feed).
    `entity_id` is the kg_entities.id UUID, not the human entity_id.
    """
    from kg_client import KgClientError, impact_analysis

    try:
        return {"ok": True, "result": impact_analysis(tenant_id, entity_id)}
    except KgClientError as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def kg_root_cause_chain(tenant_id: str, fault_entity_id: str) -> dict:
    """Walk `caused_by` from a fault entity and return the cause chain plus
    sibling alternates from prior conversations. `fault_entity_id` is the
    kg_entities.id UUID for the fault.
    """
    from kg_client import KgClientError, root_cause_chain

    try:
        return {"ok": True, "result": root_cause_chain(tenant_id, fault_entity_id)}
    except KgClientError as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def kg_traverse_chain(
    tenant_id: str,
    start_entity_id: str,
    relationship_chain: list[str],
    max_depth: int = 0,
) -> dict:
    """Follow a fixed sequence of relationship types one hop at a time.

    Example: starting at a Plant entity, chain ["parent_of","parent_of",
    "has_component"] enumerates components on every line in that plant.
    Pass max_depth=0 to use the chain length as the cap.
    """
    from kg_client import KgClientError, traverse_chain

    try:
        depth = None if max_depth == 0 else max_depth
        return {
            "ok": True,
            "result": traverse_chain(
                tenant_id,
                start_entity_id,
                relationship_chain,
                max_depth=depth,
            ),
        }
    except KgClientError as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def kg_flag_pm_mismatches(
    tenant_id: str,
    lookback_days: int = 365,
    equipment_entity_id: str = "",
) -> dict:
    """List equipment + fault pairs where MTBF is meaningfully shorter than
    the planned PM cadence. Returns advisory / warning rows with the offending
    PM task. Pass equipment_entity_id to scope to one asset.
    """
    from kg_client import KgClientError, flag_pm_mismatches

    try:
        return {
            "ok": True,
            "result": flag_pm_mismatches(
                tenant_id,
                lookback_days=lookback_days,
                equipment_entity_id=equipment_entity_id or None,
            ),
        }
    except KgClientError as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def mira_browse_namespace(tenant_id: str, uns_path: str, limit: int = 100) -> dict:
    """Browse the UNS tree under an ltree path. Returns the descendant
    entities (`<@` ltree query) so the caller can render a tree view or
    step one level deeper.

    Path grammar lives in mira-crawler/ingest/uns.py — ISA-95 literal
    markers (`site`, `area`, `line`, `work_cell`, `equipment`) alternate
    with dynamic instance labels.

    Examples:
        mira_browse_namespace(tid, "enterprise.knowledge_base")
            → every catalog manufacturer
        mira_browse_namespace(tid, "enterprise.knowledge_base.rockwell_automation")
            → families / models under Rockwell
        mira_browse_namespace(tid, "enterprise.stardust_racers.site.garage_factory")
            → areas, lines, equipment under that site
    """
    from kg_client import KgClientError, entities_under_uns_path

    try:
        return {
            "ok": True,
            "result": entities_under_uns_path(tenant_id, uns_path, limit=limit),
        }
    except KgClientError as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def mira_get_equipment(
    tenant_id: str,
    uns_path: str = "",
    equipment_entity_id: str = "",
    fault_window_days: int = 90,
) -> dict:
    """Get equipment + components + linked docs by UNS path (or entity UUID).

    Resolves the UNS path to a kg_entities row and returns the same
    payload as `kg_maintenance_context`: hierarchy, components, recent
    faults, work orders, parts, manuals, PM schedule, and plan-vs-actual
    mismatches.

    Pass exactly one of `uns_path` or `equipment_entity_id`.
    """
    from kg_client import KgClientError, maintenance_context

    if not uns_path and not equipment_entity_id:
        return {"ok": False, "error": "pass uns_path or equipment_entity_id"}

    try:
        return {
            "ok": True,
            "result": maintenance_context(
                tenant_id,
                equipment_entity_id,
                uns_path=uns_path or None,
                fault_window_days=fault_window_days,
            ),
        }
    except KgClientError as exc:
        return {"ok": False, "error": str(exc)}


@mcp.tool
def kg_extract_schematic(
    image_path: str,
    parent_equipment_id: str = "",
    drawing_ref: str = "",
) -> dict:
    """Read an electrical schematic image (IEC 60617 or ANSI/NFPA 79) and
    return the detected components + connections in the KG payload shape.

    Three vision passes: classify (IEC ladder vs ANSI one-line), detect
    symbols (contactors, motors, overloads, PLC I/O, ...), trace wired
    connections. Output is structured for direct ingestion into the KG.
    Persistence is not done here — the caller posts the payload to mira-hub
    when it's ready to commit.
    """
    from pathlib import Path

    from schematic_intelligence import run_schematic_pipeline, to_kg_payload

    p = Path(image_path)
    if not p.exists() or not p.is_file():
        return {"ok": False, "error": f"file not found: {image_path}"}
    try:
        image_bytes = p.read_bytes()
    except OSError as exc:
        return {"ok": False, "error": f"cannot read image: {exc}"}

    result = run_schematic_pipeline(image_bytes)
    payload = to_kg_payload(
        result,
        parent_equipment_id=parent_equipment_id or None,
        drawing_ref=drawing_ref or None,
    )
    return {"ok": True, "result": payload}


if __name__ == "__main__":
    import uvicorn
    from exports import export_assets, export_work_orders
    from starlette.applications import Starlette
    from starlette.routing import Route

    # Export routes authenticate via PLG JWT internally — skip MCP_REST_API_KEY check.
    _EXPORT_PATH_PREFIX = "/api/v1/exports/"

    class BearerAuthMiddleware(BaseHTTPMiddleware):
        """Require Authorization: Bearer {MCP_REST_API_KEY} on all REST requests.

        Exemptions:
          - /health (readiness probe)
          - /api/v1/exports/* (authenticated internally via PLG JWT)
        """

        async def dispatch(self, request, call_next):
            if request.url.path == "/health":
                return await call_next(request)
            if request.url.path.startswith(_EXPORT_PATH_PREFIX):
                return await call_next(request)
            # Ignition chat uses HMAC auth — skip Bearer check; handler verifies its own token.
            if request.url.path == "/api/v1/ignition/chat":
                return await call_next(request)
            auth = request.headers.get("Authorization", "")
            if not MCP_REST_API_KEY or auth != f"Bearer {MCP_REST_API_KEY}":
                return JSONResponse({"error": "unauthorized"}, status_code=401)
            return await call_next(request)

    async def rest_equipment_status(request):
        eid = request.query_params.get("equipment_id", "")
        return JSONResponse(get_equipment_status(eid))

    async def rest_active_faults(request):
        return JSONResponse(list_active_faults())

    async def rest_fault_history(request):
        eid = request.query_params.get("equipment_id", "")
        limit = int(request.query_params.get("limit", 50))
        return JSONResponse(get_fault_history(eid, limit))

    async def rest_cmms_work_orders(request):
        status = request.query_params.get("status", "")
        limit = int(request.query_params.get("limit", 20))
        return JSONResponse(await cmms_list_work_orders(status, limit))

    async def rest_cmms_create_work_order(request):
        body = await request.json()
        return JSONResponse(
            await cmms_create_work_order(
                title=body.get("title", ""),
                description=body.get("description", ""),
                priority=body.get("priority", "MEDIUM"),
                asset_id=body.get("asset_id", 0),
                category=body.get("category", "CORRECTIVE"),
            )
        )

    async def rest_cmms_assets(request):
        limit = int(request.query_params.get("limit", 50))
        return JSONResponse(await cmms_list_assets(limit))

    async def rest_cmms_pm_schedules(request):
        asset_id = int(request.query_params.get("asset_id", 0))
        limit = int(request.query_params.get("limit", 20))
        return JSONResponse(await cmms_list_pm_schedules(asset_id, limit))

    async def rest_cmms_write_work_order(request):
        body = await request.json()
        return JSONResponse(
            await cmms_write_work_order(
                title=body.get("title", ""),
                description=body.get("description", ""),
                priority=body.get("priority", "MEDIUM"),
                asset_id=body.get("asset_id", 0),
                category=body.get("category", "CORRECTIVE"),
            )
        )

    async def rest_diagnostic_record_case(request):
        body = await request.json()
        return JSONResponse(
            await diagnostic_record_case(
                title=body.get("title", ""),
                description=body.get("description", ""),
                priority=body.get("priority", "MEDIUM"),
                asset_id=body.get("asset_id", 0),
                category=body.get("category", "CORRECTIVE"),
            )
        )

    async def rest_cmms_invite(request):
        body = await request.json()
        emails = body.get("emails", [])
        role_id = int(body.get("role_id", 4))
        if not emails or not isinstance(emails, list):
            return JSONResponse({"error": "emails array required"}, status_code=400)
        if not isinstance(_atlas_internal, AtlasCMMS):
            return JSONResponse({"error": "invite_users is Atlas-only"}, status_code=501)
        return JSONResponse(await _atlas_internal.invite_users(emails, role_id))

    async def rest_cmms_health(request):
        return JSONResponse(await cmms_health())

    async def rest_cmms_nameplate(request):
        """POST /api/cmms/nameplate — create Atlas asset from extracted nameplate fields."""
        body = await request.json()
        tenant_id = body.get("tenant_id", "")
        if not tenant_id:
            return JSONResponse({"error": "tenant_id required"}, status_code=400)
        return JSONResponse(
            await create_asset_from_nameplate(
                tenant_id=tenant_id,
                manufacturer=body.get("manufacturer", ""),
                model=body.get("model", ""),
                serial=body.get("serial", ""),
                voltage=body.get("voltage", ""),
                hp=body.get("hp", ""),
                fla=body.get("fla", ""),
            )
        )

    async def rest_kg_schematic_persist(request):
        """POST /api/kg/schematic/persist — persist a previously-extracted
        schematic payload (the dict returned by ``/api/kg/schematic``) under
        a named ``parent_equipment_id``. Used by the bot's
        ``store_documentation`` action: the extraction has already happened
        on a prior turn, the user has now supplied the target name, and we
        want to commit the entities + relationships to the KG without
        re-running the vision pipeline.

        Body:
            tenant_id           (str, optional) — falls back to MIRA_TENANT_ID
            parent_equipment_id (str, required) — KG entity_id to scope under
            payload             (dict, required) — the prior /api/kg/schematic
                                  result (must contain entities[] and
                                  optionally relationships[] / schematic_type)

        Response:
            { "ok": true, "result": { entities_upserted, relationships_inserted, ... } }
            { "ok": false, "error": "..." }
        """
        from kg_client import KgClientError, upsert_schematic

        body = await request.json()
        tenant_id = body.get("tenant_id") or MIRA_TENANT_ID
        parent_equipment_id = (body.get("parent_equipment_id") or "").strip()
        payload = body.get("payload") or {}
        if not tenant_id:
            return JSONResponse(
                {"ok": False, "error": "tenant_id required for persistence"}, status_code=400
            )
        if not parent_equipment_id:
            return JSONResponse(
                {"ok": False, "error": "parent_equipment_id required"}, status_code=400
            )
        if not isinstance(payload, dict) or not payload.get("entities"):
            return JSONResponse(
                {"ok": False, "error": "payload.entities required"}, status_code=400
            )
        try:
            persisted = await asyncio.to_thread(
                upsert_schematic,
                tenant_id,
                payload,
                parent_equipment_id=parent_equipment_id,
            )
        except KgClientError as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=502)
        return JSONResponse({"ok": True, "result": persisted})

    async def rest_kg_schematic(request):
        """POST /api/kg/schematic — extract schematic components from an
        electrical drawing and (optionally) persist to the KG.

        Body:
            image_b64           (str, required) — base64 PNG/JPEG bytes
            tenant_id           (str, optional) — tenant for persistence;
                                  falls back to MIRA_TENANT_ID env var
            parent_equipment_id (str, optional) — KG entity_id to scope
                                  components under (e.g. "PLANT-A:LINE-3")
            drawing_ref         (str, optional) — drawing identifier echoed
                                  into each component's properties
            persist             (bool, optional, default False) — when True
                                  AND a tenant_id is resolvable, the entities
                                  + relationships are upserted to the KG via
                                  the hub /api/internal/kg endpoint

        Response:
            {
              "ok": true,
              "result": {
                "schematic_type": "...",
                "entities": [...],
                "relationships": [...],
                "notes": [...],
                "persisted": {                # only when persist=true
                  "entities_upserted": N,
                  "relationships_inserted": N,
                  ...
                } | {"error": "..."}
              }
            }
        """
        import base64

        from kg_client import KgClientError, upsert_schematic
        from schematic_intelligence import run_schematic_pipeline, to_kg_payload

        body = await request.json()
        image_b64 = body.get("image_b64", "")
        if not isinstance(image_b64, str) or not image_b64:
            return JSONResponse({"error": "image_b64 required"}, status_code=400)
        try:
            image_bytes = base64.b64decode(image_b64, validate=True)
        except (ValueError, TypeError) as exc:
            return JSONResponse({"error": f"invalid image_b64: {exc}"}, status_code=400)
        if not image_bytes:
            return JSONResponse({"error": "image_b64 decoded to empty bytes"}, status_code=400)

        parent_equipment_id = body.get("parent_equipment_id") or None
        drawing_ref = body.get("drawing_ref") or None
        persist = bool(body.get("persist", False))
        tenant_id = body.get("tenant_id") or MIRA_TENANT_ID

        # Pipeline runs three blocking-but-quick vision calls; offload to a
        # thread so the event loop stays responsive.
        result = await asyncio.to_thread(run_schematic_pipeline, image_bytes)
        payload = to_kg_payload(
            result,
            parent_equipment_id=parent_equipment_id,
            drawing_ref=drawing_ref,
        )

        if persist:
            if not tenant_id:
                payload["persisted"] = {"error": "tenant_id required for persistence"}
            else:
                try:
                    persisted = await asyncio.to_thread(
                        upsert_schematic,
                        tenant_id,
                        payload,
                        parent_equipment_id=parent_equipment_id,
                    )
                    payload["persisted"] = persisted
                except KgClientError as exc:
                    payload["persisted"] = {"error": str(exc)}

        return JSONResponse({"ok": True, "result": payload})

    # ── Ignition WebDev Chat ─────────────────────────────────────────────────

    async def rest_ignition_chat(request):
        """POST /api/v1/ignition/chat — receive Ignition WebDev diagnostic queries.

        Auth: HMAC-SHA256 via X-MIRA-Signature (see ignition_auth.verify_hmac).
        Engine: calls mira-pipeline /v1/chat/completions (OpenAI-compat) which
        wraps the shared GSDEngine Supervisor.process().

        Audit: no audit_log table exists in NeonDB migrations as of 2026-05-31.
        # TODO: create audit_log migration and switch this to NeonDB INSERT.
        # Tracked: add a GitHub issue for mira-hub/db/migrations/032_ignition_audit_log.sql
        # Fields to persist: tenant_id, operator, channel, prompt, sources_json,
        #   tag_reads_count, latency_ms, inference_run_id, created_at
        Interim: structured JSON log line to stdout via logger.
        """
        import json
        import time as _time
        import uuid as _uuid

        from ignition_auth import verify_hmac

        t0 = _time.monotonic()
        inference_run_id = str(_uuid.uuid4())

        # Reject immediately if key not configured
        if not MIRA_IGNITION_HMAC_KEY:
            sys.stderr.write("ERROR: MIRA_IGNITION_HMAC_KEY not set — rejecting ignition chat\n")
            return JSONResponse({"error": "MIRA_IGNITION_HMAC_KEY not configured"}, status_code=503)

        # HMAC verification — raises HTTPException(401) on failure
        try:
            tenant_id = await verify_hmac(request, MIRA_IGNITION_HMAC_KEY)
        except Exception as exc:
            # Re-raise HTTPExceptions; wrap unexpected errors as 500
            if hasattr(exc, "status_code"):
                raise
            logger.error("IGNITION_CHAT auth_error: %s", exc)
            return JSONResponse({"error": "authentication error"}, status_code=500)

        # Parse body
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        query: str = body.get("query", "").strip()
        if not query:
            return JSONResponse({"error": "query is required"}, status_code=400)

        asset_id: str = body.get("asset_id", "")
        tag_snapshot: dict = body.get("tag_snapshot", {})
        operator: str = body.get("operator", "unknown")
        session_id: str = body.get("session_id") or f"ignition-{tenant_id}"

        # Build enriched message: prepend asset + tag context so the engine
        # receives structured factory context alongside the free-text query.
        tag_lines = []
        for tag_path, tag_data in list(tag_snapshot.items())[:20]:  # cap to 20 tags
            val = tag_data.get("value", "?") if isinstance(tag_data, dict) else tag_data
            quality = tag_data.get("quality", "") if isinstance(tag_data, dict) else ""
            tag_lines.append(f"  {tag_path} = {val}" + (f" [{quality}]" if quality else ""))

        tag_block = "\n".join(tag_lines)
        effective_message = query
        if asset_id:
            effective_message = f"[Asset: {asset_id}]\n{query}"
        if tag_block:
            effective_message = f"{effective_message}\n\nLive tag snapshot:\n{tag_block}"

        # Call mira-pipeline /v1/chat/completions — the OpenAI-compat wrapper
        # around GSDEngine Supervisor.process().  Pass channel='ignition' in
        # metadata so future pipeline versions can enforce citation-compliance
        # in stricter mode for this path (per architecture doc §3.2 step 4).
        pipeline_payload = {
            "model": "mira-diagnostic",
            "messages": [{"role": "user", "content": effective_message}],
            "stream": False,
            "user": session_id,
            "metadata": {
                "channel": "ignition",
                "tenant_id": tenant_id,
                "operator": operator,
                "asset_id": asset_id,
                "inference_run_id": inference_run_id,
            },
        }

        try:
            async with _httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{PIPELINE_BASE_URL}/v1/chat/completions",
                    headers=_pipeline_headers(),
                    json=pipeline_payload,
                )
                resp.raise_for_status()
                pipeline_data = resp.json()
        except _httpx.HTTPStatusError as exc:
            logger.error(
                "IGNITION_CHAT pipeline_error status=%d tenant=%s: %s",
                exc.response.status_code,
                tenant_id,
                exc.response.text[:300],
            )
            return JSONResponse(
                {"error": "diagnostic engine unavailable"},
                status_code=502,
            )
        except Exception as exc:
            logger.error("IGNITION_CHAT pipeline_error tenant=%s: %s", tenant_id, exc)
            return JSONResponse({"error": "diagnostic engine unavailable"}, status_code=502)

        answer: str = (
            pipeline_data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )

        # Build sources from tag snapshot (tag-type sources; manual/WO sources
        # would require the engine to surface citation metadata — post-MVP).
        tag_sources = [
            {
                "type": "tag",
                "ref": tag_path,
                "value": str(tag_data.get("value", "?") if isinstance(tag_data, dict) else tag_data),
            }
            for tag_path, tag_data in list(tag_snapshot.items())[:10]
        ]

        latency_ms = int((_time.monotonic() - t0) * 1000)

        # Determine UNS gate state from answer content (heuristic — post-MVP
        # should come from a structured engine response field).
        uns_gate_state = "confirmed"
        if any(kw in answer.lower() for kw in ("which conveyor", "which machine", "which asset", "can you confirm", "please confirm")):
            uns_gate_state = "awaiting_confirmation"

        response_payload = {
            "answer": answer,
            "sources": tag_sources,
            "confidence": 0.0,   # post-MVP: surface from engine
            "suggested_actions": [],
            "uns_gate": {
                "state": uns_gate_state,
                "asset": asset_id,
                "evidence": [],
            },
            "latency_ms": latency_ms,
            "inference_run_id": inference_run_id,
        }

        # Audit log — structured stdout (no audit_log table in NeonDB yet).
        # TODO: replace with INSERT into audit_log once migration 032 is applied.
        logger.info(
            "IGNITION_AUDIT %s",
            json.dumps({
                "tenant_id": tenant_id,
                "operator": operator,
                "channel": "ignition",
                "prompt_preview": query[:200],
                "tag_reads_count": len(tag_snapshot),
                "latency_ms": latency_ms,
                "inference_run_id": inference_run_id,
            }),
        )

        return JSONResponse(response_payload)

    async def health(request):
        return JSONResponse({"status": "ok"})

    async def _not_found(request, exc):
        return JSONResponse({"error": "not found"}, status_code=404)

    rest_app = Starlette(
        routes=[
            Route("/health", health),
            Route("/api/equipment", rest_equipment_status),
            Route("/api/faults/active", rest_active_faults),
            Route("/api/faults/history", rest_fault_history),
            Route("/api/cmms/work-orders", rest_cmms_work_orders),
            Route("/api/cmms/work-orders", rest_cmms_create_work_order, methods=["POST"]),
            Route("/api/cmms/write-work-order", rest_cmms_write_work_order, methods=["POST"]),
            Route("/api/diagnostic/case", rest_diagnostic_record_case, methods=["POST"]),
            Route("/api/cmms/assets", rest_cmms_assets),
            Route("/api/cmms/pm-schedules", rest_cmms_pm_schedules),
            Route("/api/cmms/invite", rest_cmms_invite, methods=["POST"]),
            Route("/api/cmms/health", rest_cmms_health),
            Route("/api/cmms/nameplate", rest_cmms_nameplate, methods=["POST"]),
            Route("/api/kg/schematic", rest_kg_schematic, methods=["POST"]),
            Route("/api/kg/schematic/persist", rest_kg_schematic_persist, methods=["POST"]),
            Route("/ingest/pdf", _rest_ingest_pdf, methods=["POST"]),
            Route("/api/embed", _rest_embed, methods=["POST"]),
            # Unit 4 — Excel/CSV live export (PLG-JWT-authed, no MCP_REST_API_KEY needed)
            Route("/api/v1/exports/assets.xlsx", export_assets),
            Route("/api/v1/exports/work-orders.xlsx", export_work_orders),
            # Ignition WebDev chat — HMAC-authed, exempt from BearerAuthMiddleware
            Route("/api/v1/ignition/chat", rest_ignition_chat, methods=["POST"]),
        ],
        exception_handlers={404: _not_found},
    )
    rest_app.add_middleware(BearerAuthMiddleware)

    async def main():
        rest_config = uvicorn.Config(rest_app, host="0.0.0.0", port=8001, log_level="info")
        rest_server = uvicorn.Server(rest_config)
        # FastMCP v3: run_sse_async was removed. Use run_http_async with
        # transport="sse" (legacy compat) — same wire format as v0.4 for
        # existing MCP clients. Host/port come from FASTMCP_HOST/FASTMCP_PORT
        # env if set; fall back to container defaults.
        sse_host = os.environ.get("FASTMCP_HOST", "0.0.0.0")
        sse_port = int(os.environ.get("FASTMCP_PORT", "8000"))
        # streamable-http on port 8002 for Warp/modern MCP clients (/mcp endpoint)
        http_port = int(os.environ.get("FASTMCP_HTTP_PORT", "8002"))
        await asyncio.gather(
            mcp.run_http_async(transport="sse", host=sse_host, port=sse_port),
            mcp.run_http_async(transport="streamable-http", host=sse_host, port=http_port),
            rest_server.serve(),
        )

    asyncio.run(main())
