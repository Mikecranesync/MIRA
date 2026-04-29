"""Full KB ingest pipeline — download → extract → chunk/embed → KG → quality gate.

Each step is fault-tolerant: a failure in one step logs the error and moves on.
The pipeline never crashes; it always prints a report.

Steps
-----
1. DOWNLOAD       — HTTP stream to /opt/mira/manuals/{manufacturer}/{model}/
2. EXTRACT        — Docling sync (≤512 KB) or page-split fallback for larger PDFs
3. CHUNK + EMBED  — ingest_text_inline() → knowledge_entries (pgvector)
4. KG ENTITIES    — extract_equipment + extract_fault_codes → kg_entities + relationships
5. QUALITY GATE   — compare 10 KB-sensitive cases before/after (optional, subprocess)

CLI
---
python -m mira_crawler.tasks.full_ingest_pipeline \\
  --pdf-url https://cdn.automationdirect.com/static/manuals/1606xlsinstall.pdf \\
  --manufacturer "Allen-Bradley" \\
  --model "1606-XLS" \\
  --type installation_manual

Or locally:
python mira-crawler/tasks/full_ingest_pipeline.py --pdf-url ... --manufacturer ... --model ...
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx

# ---------------------------------------------------------------------------
# Path bootstrap (works standalone or as mira_crawler.tasks.full_ingest_pipeline)
# ---------------------------------------------------------------------------

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO_ROOT = _CRAWLER_ROOT.parent
_BOTS_ROOT = _REPO_ROOT / "mira-bots"
_EXTRACTORS = _BOTS_ROOT / "benchmarks" / "corpus" / "extractors"

for _p in [str(_CRAWLER_ROOT), str(_BOTS_ROOT)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logger = logging.getLogger("mira.full_ingest")

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------

DOCLING_URL = os.getenv("DOCLING_URL", "http://localhost:5001")
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
TENANT_ID = os.getenv("MIRA_TENANT_ID", "")
NEON_URL = os.getenv("NEON_DATABASE_URL", "")
MANUALS_ROOT = Path(os.getenv("MANUALS_ROOT", "/opt/mira/manuals"))

DOCLING_SYNC_LIMIT = 512 * 1024          # 512 KB — use sync below this
DOCLING_TIMEOUT_SYNC = 300               # seconds
DOCLING_TIMEOUT_ASYNC_POLL = 600         # max poll wait
LARGE_SKIP_BYTES = 50 * 1024 * 1024     # 50 MB — skip docling entirely

REQUEST_HEADERS = {"User-Agent": "MIRA-KB/1.0 (+https://factorylm.com; ops@factorylm.com)"}
QUALITY_GATE = _BOTS_ROOT / "benchmarks" / "kb_quality_gate.py"

_B64_RE = re.compile(r"data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=\s]+")

# ---------------------------------------------------------------------------
# Report dataclass
# ---------------------------------------------------------------------------


@dataclass
class PipelineReport:
    pdf_url: str
    pdf_path: str = ""
    pdf_bytes: int = 0
    docling_pages: int = 0
    docling_chars: int = 0
    docling_method: str = ""  # sync | split | skip | failed
    kb_chunks: int = 0
    kg_equipment_entities: int = 0
    kg_fault_code_entities: int = 0
    kg_relationships: int = 0
    kg_triples: int = 0
    quality_gate: str = "skipped"
    errors: list[str] = field(default_factory=list)

    def print(self) -> None:
        w = 54
        print(f"\n{'═'*w}")
        print("INGEST PIPELINE REPORT")
        print(f"{'═'*w}")
        print(f"PDF:          {Path(self.pdf_path).name} ({self.pdf_bytes/1024/1024:.1f} MB)")
        print(f"Docling:      {self.docling_method} → {self.docling_chars:,} chars extracted")
        print(f"KB Chunks:    {self.kb_chunks} chunks created (2000 char, 200 overlap)")
        print(f"KG Entities:  {self.kg_equipment_entities} equipment, "
              f"{self.kg_fault_code_entities} fault codes")
        print(f"KG Relations: {self.kg_relationships} relationships created")
        print(f"KG Triples:   {self.kg_triples} logged (source: manual_ingest)")
        print(f"Quality Gate: {self.quality_gate}")
        if self.errors:
            print(f"\nErrors ({len(self.errors)}):")
            for e in self.errors:
                print(f"  • {e}")
        print(f"{'═'*w}\n")


# ---------------------------------------------------------------------------
# STEP 1: DOWNLOAD
# ---------------------------------------------------------------------------


def _download(url: str, dest: Path) -> tuple[bool, int]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        logger.info("Download: cached (%s)", dest.name)
        return True, dest.stat().st_size
    logger.info("Downloading: %s", url)
    try:
        timeout = httpx.Timeout(connect=15.0, read=120.0, write=30.0, pool=5.0)
        with httpx.stream("GET", url, headers=REQUEST_HEADERS, timeout=timeout,
                          follow_redirects=True) as r:
            if r.status_code != 200:
                raise RuntimeError(f"HTTP {r.status_code}")
            written = 0
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(65536):
                    f.write(chunk)
                    written += len(chunk)
        logger.info("Downloaded: %s (%s KB)", dest.name, written // 1024)
        return True, written
    except Exception as exc:
        logger.error("Download failed: %s", exc)
        return False, 0


# ---------------------------------------------------------------------------
# STEP 2: EXTRACT TEXT (Docling)
# ---------------------------------------------------------------------------


def _strip_images(md: str) -> str:
    md = re.sub(r"!\[.*?\]\(data:image/[^)]+\)", "[image]", md)
    return _B64_RE.sub("[image]", md).strip()


def _docling_sync(pdf_path: Path) -> tuple[str, str]:
    """Send PDF to docling sync endpoint. Returns (markdown, method_label)."""
    with open(pdf_path, "rb") as f:
        data = f.read()
    options = {"image_export_mode": "placeholder"}
    with httpx.Client(timeout=DOCLING_TIMEOUT_SYNC) as client:
        resp = client.post(
            f"{DOCLING_URL}/v1/convert/file",
            files={"files": (pdf_path.name, data, "application/pdf")},
            data={"options": json.dumps(options)},
        )
    resp.raise_for_status()
    md = resp.json().get("document", {}).get("md_content", "") or ""
    return _strip_images(md), "sync"


def _docling_split(pdf_path: Path, chunk_pages: int = 15) -> tuple[str, str]:
    """Split PDF into page chunks, run each through docling, concatenate."""
    try:
        import pypdf
    except ImportError:
        raise RuntimeError("pypdf not installed — cannot split PDF")

    reader = pypdf.PdfReader(str(pdf_path))
    total = len(reader.pages)
    texts: list[str] = []

    for start in range(0, total, chunk_pages):
        end = min(start + chunk_pages, total)
        writer = pypdf.PdfWriter()
        for i in range(start, end):
            writer.add_page(reader.pages[i])

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
            tmp = Path(tf.name)
            writer.write(tf)

        try:
            md, _ = _docling_sync(tmp)
            texts.append(md)
            logger.info("Split chunk pages %d-%d: %d chars", start + 1, end, len(md))
        except Exception as exc:
            logger.warning("Split chunk %d-%d failed: %s", start + 1, end, exc)
        finally:
            tmp.unlink(missing_ok=True)

        time.sleep(1)

    return "\n\n".join(texts), "split"


def step_extract(pdf_path: Path, report: PipelineReport) -> str:
    size = pdf_path.stat().st_size

    if size >= LARGE_SKIP_BYTES:
        report.docling_method = "skip (>50 MB)"
        logger.warning("PDF too large for docling: %.1f MB", size / 1024 / 1024)
        return ""

    try:
        if size <= DOCLING_SYNC_LIMIT:
            md, method = _docling_sync(pdf_path)
        else:
            # Try sync first; fall back to split on 504
            try:
                md, method = _docling_sync(pdf_path)
            except Exception as exc:
                if "504" in str(exc) or "timeout" in str(exc).lower():
                    logger.info("Sync timed out — retrying with page splits")
                    md, method = _docling_split(pdf_path)
                else:
                    raise

        # Estimate page count from headings
        report.docling_pages = md.count("\n# ") + md.count("\n## ") or 1
        report.docling_chars = len(md)
        report.docling_method = method
        logger.info("Docling %s: %d chars", method, len(md))
        return md

    except Exception as exc:
        report.docling_method = "failed"
        report.errors.append(f"Docling: {exc}")
        logger.error("Docling failed: %s", exc)
        return ""


# ---------------------------------------------------------------------------
# STEP 3: CHUNK + EMBED → knowledge_entries
# ---------------------------------------------------------------------------


def step_kb_ingest(text: str, source_url: str, manual_type: str,
                   report: PipelineReport) -> None:
    if not text or not TENANT_ID:
        if not TENANT_ID:
            report.errors.append("KB ingest: MIRA_TENANT_ID not set")
        return
    try:
        try:
            from tasks._shared import ingest_text_inline
        except ImportError:
            from mira_crawler.tasks._shared import ingest_text_inline

        n = ingest_text_inline(
            text=text,
            source_url=source_url,
            source_type=manual_type,
            tenant_id=TENANT_ID,
            ollama_url=OLLAMA_URL,
            embed_model=EMBED_MODEL,
        )
        report.kb_chunks = n
        logger.info("KB ingest: %d chunks stored", n)
    except Exception as exc:
        report.errors.append(f"KB ingest: {exc}")
        logger.error("KB ingest failed: %s", exc)


# ---------------------------------------------------------------------------
# STEP 4: KG EXTRACTION
# ---------------------------------------------------------------------------


def _pg_conn():
    import psycopg2
    conn = psycopg2.connect(NEON_URL)
    conn.autocommit = False
    return conn


def _upsert_entity(cur, entity_type: str, entity_id: str, name: str,
                   properties: dict) -> str | None:
    try:
        cur.execute(
            """
            INSERT INTO kg_entities (id, tenant_id, entity_type, entity_id, name, properties)
            VALUES (%s, %s::uuid, %s, %s, %s, %s::jsonb)
            ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE
                SET name = EXCLUDED.name,
                    properties = kg_entities.properties || EXCLUDED.properties,
                    updated_at = now()
            RETURNING id
            """,
            (str(uuid.uuid4()), TENANT_ID, entity_type, entity_id,
             name, json.dumps(properties)),
        )
        row = cur.fetchone()
        return str(row[0]) if row else None
    except Exception as exc:
        logger.warning("upsert_entity %s/%s failed: %s", entity_type, entity_id, exc)
        return None


def _log_triple(cur, subject: str, predicate: str, obj: str) -> bool:
    try:
        cur.execute(
            """
            INSERT INTO kg_triples_log (id, tenant_id, subject, predicate, object, source)
            VALUES (%s, %s::uuid, %s, %s, %s, 'manual_ingest')
            """,
            (str(uuid.uuid4()), TENANT_ID, subject, predicate, obj),
        )
        return True
    except Exception as exc:
        logger.warning("log_triple failed: %s", exc)
        return False


def step_kg(text: str, manufacturer: str, model: str,
            manual_type: str, source_url: str, report: PipelineReport) -> None:
    if not NEON_URL or not TENANT_ID:
        report.errors.append("KG: NEON_DATABASE_URL or MIRA_TENANT_ID not set")
        return

    try:
        from benchmarks.corpus.extractors.equipment import extract_equipment
        from benchmarks.corpus.extractors.fault_codes import extract_fault_codes
    except ImportError:
        try:
            sys.path.insert(0, str(_EXTRACTORS.parent.parent))
            from corpus.extractors.equipment import extract_equipment
            from corpus.extractors.fault_codes import extract_fault_codes
        except ImportError as exc:
            report.errors.append(f"KG extractors not importable: {exc}")
            return

    # Run extractors on first 8000 chars (enough context, bounded cost)
    sample = text[:8000]
    equip = extract_equipment(sample)
    fault_codes = extract_fault_codes(sample)

    # Use provided manufacturer/model as ground truth, extractors as enrichment
    eff_mfr = manufacturer or equip.manufacturer or "Unknown"
    eff_model = model or equip.model or "Unknown"

    try:
        conn = _pg_conn()
        cur = conn.cursor()

        # --- Equipment entity (the manual's primary subject) ---
        equip_id = _upsert_entity(
            cur,
            entity_type="equipment",
            entity_id=f"{eff_mfr.lower().replace(' ', '-')}::{eff_model.lower()}",
            name=f"{eff_mfr} {eff_model}",
            properties={
                "manufacturer": eff_mfr,
                "model": eff_model,
                "equipment_type": equip.equipment_type or manual_type,
                "source_url": source_url,
            },
        )
        if equip_id:
            report.kg_equipment_entities += 1
            _log_triple(cur, f"{eff_mfr} {eff_model}", "has_manual", source_url)
            report.kg_triples += 1

        # --- Manual entity ---
        manual_eid = _upsert_entity(
            cur,
            entity_type="manual",
            entity_id=source_url,
            name=f"{eff_mfr} {eff_model} — {manual_type}",
            properties={"manual_type": manual_type, "source_url": source_url},
        )
        if equip_id and manual_eid:
            try:
                cur.execute(
                    """
                    INSERT INTO kg_relationships
                        (id, tenant_id, source_id, target_id, relationship_type, confidence)
                    VALUES (%s, %s::uuid, %s::uuid, %s::uuid, 'documented_in', 1.0)
                    ON CONFLICT DO NOTHING
                    """,
                    (str(uuid.uuid4()), TENANT_ID, equip_id, manual_eid),
                )
                report.kg_relationships += 1
                _log_triple(cur, f"{eff_mfr} {eff_model}", "documented_in",
                            f"{eff_mfr} {eff_model} — {manual_type}")
                report.kg_triples += 1
            except Exception as exc:
                logger.warning("KG relationship insert failed: %s", exc)

        # --- Fault code entities ---
        for fc in fault_codes[:20]:  # cap at 20 per document
            fc_id = _upsert_entity(
                cur,
                entity_type="fault_code",
                entity_id=f"{fc.manufacturer.lower()}::{fc.code.upper()}",
                name=fc.code,
                properties={
                    "manufacturer": fc.manufacturer,
                    "description": fc.description,
                    "source_url": source_url,
                },
            )
            if fc_id:
                report.kg_fault_code_entities += 1
                if equip_id:
                    try:
                        cur.execute(
                            """
                            INSERT INTO kg_relationships
                                (id, tenant_id, source_id, target_id,
                                 relationship_type, confidence)
                            VALUES (%s, %s::uuid, %s::uuid, %s::uuid, 'has_fault_code', 1.0)
                            ON CONFLICT DO NOTHING
                            """,
                            (str(uuid.uuid4()), TENANT_ID, equip_id, fc_id),
                        )
                        report.kg_relationships += 1
                    except Exception as exc:
                        logger.warning("Fault code relationship: %s", exc)
                _log_triple(cur, fc.code, "documented_in", f"{eff_mfr} {eff_model}")
                report.kg_triples += 1

        conn.commit()
        logger.info("KG: %d equipment, %d fault codes, %d relationships, %d triples",
                    report.kg_equipment_entities, report.kg_fault_code_entities,
                    report.kg_relationships, report.kg_triples)

    except Exception as exc:
        report.errors.append(f"KG write: {exc}")
        logger.error("KG write failed: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# STEP 5: QUALITY GATE (subprocess)
# ---------------------------------------------------------------------------


def step_quality_gate(baseline_path: str | None, report: PipelineReport) -> None:
    if not baseline_path:
        report.quality_gate = (
            f"skipped — run baseline first:\n"
            f"  python3 {QUALITY_GATE} baseline\n"
            f"  then: python3 {QUALITY_GATE} gate <baseline.json>"
        )
        return

    import subprocess
    cmd = [sys.executable, str(QUALITY_GATE), "gate", baseline_path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        lines = (result.stdout + result.stderr).strip().splitlines()
        summary = next((l for l in lines if "GATE" in l and ("PASS" in l or "FAIL" in l)), "")
        report.quality_gate = summary or ("PASS" if result.returncode == 0 else "FAIL")
        if result.returncode != 0:
            report.errors.append(f"Quality gate failed: {summary}")
    except subprocess.TimeoutExpired:
        report.quality_gate = "timeout"
        report.errors.append("Quality gate timed out after 600s")
    except Exception as exc:
        report.quality_gate = f"error: {exc}"
        report.errors.append(f"Quality gate: {exc}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run(
    pdf_url: str,
    manufacturer: str,
    model: str,
    manual_type: str,
    baseline_path: str | None = None,
    no_quality_gate: bool = False,
) -> PipelineReport:
    report = PipelineReport(pdf_url=pdf_url)

    # Destination path
    dest = MANUALS_ROOT / manufacturer.replace("/", "-") / model.replace("/", "-") / (
        Path(pdf_url.split("?")[0]).name or "manual.pdf"
    )
    if not dest.suffix:
        dest = dest.with_suffix(".pdf")
    report.pdf_path = str(dest)

    # 1. Download
    ok, nbytes = _download(pdf_url, dest)
    report.pdf_bytes = nbytes
    if not ok:
        report.errors.append(f"Download failed: {pdf_url}")
        report.print()
        return report

    # 2. Extract
    text = step_extract(dest, report)
    txt_path = dest.with_suffix(".txt")
    if text:
        txt_path.write_text(text, encoding="utf-8")
        logger.info("Saved text: %s (%d chars)", txt_path.name, len(text))

    # 3. KB ingest
    if text:
        step_kb_ingest(text, pdf_url, manual_type, report)

    # 4. KG
    if text:
        step_kg(text, manufacturer, model, manual_type, pdf_url, report)

    # 5. Quality gate
    if not no_quality_gate:
        step_quality_gate(baseline_path, report)

    report.print()
    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="MIRA full KB ingest pipeline")
    p.add_argument("--pdf-url", required=True, help="Direct PDF download URL")
    p.add_argument("--manufacturer", required=True, help="Manufacturer name (e.g. Allen-Bradley)")
    p.add_argument("--model", required=True, help="Model number (e.g. 1606-XLS)")
    p.add_argument("--type", dest="manual_type", default="equipment_manual",
                   help="Manual type (default: equipment_manual)")
    p.add_argument("--baseline", default=None,
                   help="Path to kb_quality_gate baseline JSON (enables gate comparison)")
    p.add_argument("--no-quality-gate", action="store_true",
                   help="Skip quality gate step entirely")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    report = run(
        pdf_url=args.pdf_url,
        manufacturer=args.manufacturer,
        model=args.model,
        manual_type=args.manual_type,
        baseline_path=args.baseline,
        no_quality_gate=args.no_quality_gate,
    )
    sys.exit(1 if report.errors else 0)
