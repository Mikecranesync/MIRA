"""MIRA MCP Server — three tools for equipment diagnostics."""

import os
import sqlite3
from fastmcp import FastMCP

DB_PATH = os.environ.get("MIRA_DB_PATH", "/data/mira.db")

mcp = FastMCP("mira-mcp", description="MIRA equipment diagnostics tools")


def _get_db():
    return sqlite3.connect(DB_PATH)


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
    return {"fault_history": rows}


@mcp.tool()
def get_maintenance_notes(equipment_id: str = "", category: str = "", limit: int = 50) -> list[dict]:
    """Get maintenance notes for equipment. Filter by equipment_id and/or category."""
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    conn = sqlite3.connect(db_path)
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


if __name__ == "__main__":
    import asyncio
    import uvicorn
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def rest_equipment_status(request):
        eid = request.query_params.get("equipment_id", "")
        return JSONResponse(get_equipment_status(eid))

    async def rest_active_faults(request):
        return JSONResponse(list_active_faults())

    async def rest_fault_history(request):
        eid = request.query_params.get("equipment_id", "")
        limit = int(request.query_params.get("limit", 50))
        return JSONResponse(get_fault_history(eid, limit))

    async def _not_found(request, exc):
        return JSONResponse({"error": "not found"}, status_code=404)

    rest_app = Starlette(
        routes=[
            Route("/api/equipment", rest_equipment_status),
            Route("/api/faults/active", rest_active_faults),
            Route("/api/faults/history", rest_fault_history),
        ],
        exception_handlers={404: _not_found},
    )

    async def main():
        rest_config = uvicorn.Config(rest_app, host="0.0.0.0", port=8001, log_level="info")
        rest_server = uvicorn.Server(rest_config)
        await asyncio.gather(mcp.run_sse_async(), rest_server.serve())

    asyncio.run(main())
