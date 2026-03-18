"""MIRA MCP Server — three tools for equipment diagnostics."""

import os
import sys
import sqlite3
from fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

DB_PATH = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
MCP_REST_API_KEY = os.environ.get("MCP_REST_API_KEY", "")
RETRIEVAL_BACKEND = os.environ.get("RETRIEVAL_BACKEND", "openwebui")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "")

_viking_ok = False
if RETRIEVAL_BACKEND == "openviking":
    try:
        from context.viking_store import retrieve as _viking_retrieve
        _viking_ok = True
        sys.stderr.write(f"INFO: OpenViking retrieval backend active\n")
    except Exception as _e:
        sys.stderr.write(f"WARNING: OpenViking import failed: {_e}\n")
if not MCP_REST_API_KEY:
    sys.stderr.write("ERROR: MCP_REST_API_KEY not set — REST :8001 will reject all requests\n")
    sys.stderr.flush()

mcp = FastMCP("mira-mcp", description="MIRA equipment diagnostics tools")


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
    for suffix in ("-manual", "-guide", "-spec", "-datasheet", "-data-sheet",
                   "_manual", "_guide", "_spec", "_datasheet", "_data_sheet"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return stem[:40] or "general"


@mcp.tool()
def get_equipment_status(equipment_id: str = "") -> dict:
    """Get current status of equipment. Pass equipment_id to filter, or omit for all."""
    db = _get_db()
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    if equipment_id:
        cur.execute(
            "SELECT * FROM equipment_status WHERE equipment_id = ?", (equipment_id,)
        )
    else:
        cur.execute("SELECT * FROM equipment_status")
    rows = [dict(r) for r in cur.fetchall()]
    db.close()
    return {"equipment": rows}


@mcp.tool()
def list_active_faults() -> dict:
    """List all currently active faults across all equipment."""
    db = _get_db()
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    cur.execute("SELECT * FROM faults WHERE resolved = 0 ORDER BY timestamp DESC")
    rows = [dict(r) for r in cur.fetchall()]
    db.close()
    return {"active_faults": rows}


@mcp.tool()
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


@mcp.tool()
def get_maintenance_notes(equipment_id: str = "", category: str = "", limit: int = 50) -> list[dict]:
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

        tenant_id = MIRA_TENANT_ID or "default"
        chunks = _ingest_pdf(save_path, tenant_id, equipment_type)
        sys.stderr.write(
            f"INFO: Ingested {chunks} chunks from {filename} "
            f"(type={equipment_type}, tenant={tenant_id})\n"
        )
        return JSONResponse({
            "status": "ok",
            "filename": filename,
            "chunks": chunks,
            "equipment_type": equipment_type,
        })
    except Exception as exc:
        sys.stderr.write(f"ERROR: /ingest/pdf failed: {exc}\n")
        return JSONResponse({"error": str(exc)}, status_code=500)


if __name__ == "__main__":
    import asyncio
    import uvicorn
    from starlette.applications import Starlette
    from starlette.routing import Route

    class BearerAuthMiddleware(BaseHTTPMiddleware):
        """Require Authorization: Bearer {MCP_REST_API_KEY} on all REST requests except /health."""

        async def dispatch(self, request, call_next):
            if request.url.path == "/health":
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
            Route("/ingest/pdf", _rest_ingest_pdf, methods=["POST"]),
        ],
        exception_handlers={404: _not_found},
    )
    rest_app.add_middleware(BearerAuthMiddleware)

    async def main():
        rest_config = uvicorn.Config(rest_app, host="0.0.0.0", port=8001, log_level="info")
        rest_server = uvicorn.Server(rest_config)
        await asyncio.gather(mcp.run_sse_async(), rest_server.serve())

    asyncio.run(main())
