"""Parse worker for contextualization projects.

Receives a source_id, reads the source file, runs mira_plc_parser, and writes
ctx_extractions rows (one per tag) with proposed UNS paths and roles.

Usage:
    python ctx_parse_worker.py <source_id>

Env:
    NEON_DATABASE_URL  — NeonDB connection string (psycopg2 format)
    MIRA_PARSER_ROOT   — optional override for the mira-plc-parser package root
"""

from __future__ import annotations

import json
import logging
import os
import sys
import uuid

import psycopg2
import psycopg2.extras

# Allow running from the repo root or mira-hub/workers without an install.
_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
_PARSER_ROOT = os.environ.get("MIRA_PARSER_ROOT", os.path.join(_REPO_ROOT, "mira-plc-parser"))
if _PARSER_ROOT not in sys.path:
    sys.path.insert(0, _PARSER_ROOT)

from mira_plc_parser import pipeline  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ctx-parse-worker")

_CONFIDENCE_MAP = {"high": 0.9, "medium": 0.6, "low": 0.3}


def _get_conn() -> "psycopg2.connection":
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return psycopg2.connect(url, sslmode="require")


def _run(source_id: str) -> None:
    conn = _get_conn()
    try:
        with conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """SELECT id, tenant_id, project_id, file_name, file_path
                       FROM ctx_sources WHERE id = %s""",
                    (source_id,),
                )
                row = cur.fetchone()
        if row is None:
            log.error("source_id %s not found", source_id)
            sys.exit(1)

        tenant_id = str(row["tenant_id"])
        project_id = str(row["project_id"])
        file_name = row["file_name"]
        file_path = row["file_path"]

        # Mark processing
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ctx_sources SET status='processing' WHERE id=%s",
                    (source_id,),
                )

        # Read source file
        if not file_path or not os.path.exists(file_path):
            _mark_error(conn, source_id, "file not found: %s" % file_path)
            return
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()

        # Parse + analyze
        result = pipeline.run(file_name, text)
        report = pipeline.render_json(result)

        # Build tag -> UNS candidate index
        uns_by_tag: dict[str, dict] = {}
        for u in report.get("uns_candidates", []):
            uns_by_tag[u["tag"]] = u

        # Write extractions (one per tag in the dictionary)
        extractions = []
        for tag in report.get("tag_dictionary", []):
            tag_name = tag.get("name", "")
            if not tag_name:
                continue
            roles = tag.get("roles") or []
            uns = uns_by_tag.get(tag_name, {})
            uns_path = uns.get("path") or None
            confidence_str = uns.get("confidence") or tag.get("confidence") or "low"
            confidence = _CONFIDENCE_MAP.get(confidence_str, 0.3)
            # i3x element ID = UNS path (the signal leaf, unique within the project)
            i3x_element_id = uns_path or None
            evidence = {
                "source_format": report.get("detection", {}).get("fmt"),
                "used_in": tag.get("used_in", [])[:6],
                "confidence_source": confidence_str,
                "uns_evidence": uns.get("evidence"),
            }
            extractions.append(
                (
                    str(uuid.uuid4()),
                    tenant_id,
                    project_id,
                    source_id,
                    tag_name,
                    roles,
                    uns_path,
                    i3x_element_id,
                    json.dumps(evidence),
                    confidence,
                )
            )

        with conn:
            with conn.cursor() as cur:
                if extractions:
                    psycopg2.extras.execute_values(
                        cur,
                        """INSERT INTO ctx_extractions
                             (id, tenant_id, project_id, source_id, tag_name, roles,
                              uns_path_proposed, i3x_element_id, evidence_json, confidence)
                           VALUES %s
                           ON CONFLICT DO NOTHING""",
                        extractions,
                    )
                cur.execute(
                    "UPDATE ctx_sources SET status='done' WHERE id=%s",
                    (source_id,),
                )

        log.info(
            "source %s done: %d tags extracted, %d with UNS proposals",
            source_id,
            len(extractions),
            sum(1 for e in extractions if e[6] is not None),
        )
    except Exception as exc:
        log.exception("parse failed for source %s", source_id)
        _mark_error(conn, source_id, str(exc))
        sys.exit(1)
    finally:
        conn.close()


def _mark_error(conn: "psycopg2.connection", source_id: str, msg: str) -> None:
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ctx_sources SET status='error', error_message=%s WHERE id=%s",
                    (msg[:2000], source_id),
                )
    except Exception:
        log.exception("failed to mark error for source %s", source_id)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: ctx_parse_worker.py <source_id>", file=sys.stderr)
        sys.exit(1)
    _run(sys.argv[1])
