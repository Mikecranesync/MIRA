"""Full KB ingest pipeline — download → extract → chunk/embed → KG → quality gate.

Each step is fault-tolerant: a failure in one step logs the error and moves on.
The pipeline never crashes; it always prints a report.

Steps
-----
1. DOWNLOAD       — HTTP stream to /opt/mira/manuals/{manufacturer}/{model}/
2. EXTRACT        — local pdfplumber/pypdf text extraction (ingest.pdf_extract)
3. CHUNK + EMBED  — ingest_text_inline() → knowledge_entries (pgvector)
4. KG ENTITIES    — extract_equipment + extract_fault_codes → kg_entities + relationships
5. QUALITY GATE   — compare 10 KB-sensitive cases before/after (optional, subprocess)
6. EVIDENCE       — candidate Materialized Evidence receipt: byte identity + the real
                    extraction method, referencing (never copying) the knowledge_entries
                    materialization. Optional (`--evidence-registry` /
                    `MIRA_EVIDENCE_REGISTRY`) and fail-open — a failure never fails the
                    ingest, it is journaled as an `evidence_pending` repair item to
                    `<snapshot>.repair.jsonl` carrying enough to replay the receipt
                    without re-downloading. Fetch URLs are redacted before they reach
                    either durable surface. Replaying that journal is an explicit
                    operator command (`--replay-evidence-journal`), so a recorded gap
                    has a way to actually close.

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
import sys
import uuid
from contextlib import contextmanager
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

# Repo root, for `materialized_evidence` (step 6). APPENDED, not inserted: the
# crawler's own imports must keep resolving first (repo-root `tests/`/`tools/`
# would otherwise shadow them).
if str(_REPO_ROOT) not in sys.path:
    sys.path.append(str(_REPO_ROOT))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logger = logging.getLogger("mira.full_ingest")

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
TENANT_ID = os.getenv("MIRA_TENANT_ID", "")
NEON_URL = os.getenv("NEON_DATABASE_URL", "")
MANUALS_ROOT = Path(os.getenv("MANUALS_ROOT", "/opt/mira/manuals"))

# Materialized Evidence receipts (step 6) — OPTIONAL and fail-open. Unset means
# ingest behaves exactly as before; no receipt is compiled and nothing is written.
EVIDENCE_REGISTRY = os.getenv("MIRA_EVIDENCE_REGISTRY", "")
EVIDENCE_ENV = os.getenv("MIRA_EVIDENCE_ENV", "dev")

LARGE_SKIP_BYTES = 50 * 1024 * 1024     # 50 MB — skip extraction entirely

REQUEST_HEADERS = {"User-Agent": "MIRA-KB/1.0 (+https://factorylm.com; ops@factorylm.com)"}
QUALITY_GATE = _BOTS_ROOT / "benchmarks" / "kb_quality_gate.py"

# ---------------------------------------------------------------------------
# Report dataclass
# ---------------------------------------------------------------------------


@dataclass
class PipelineReport:
    pdf_url: str
    pdf_path: str = ""
    pdf_bytes: int = 0
    extract_pages: int = 0
    extract_chars: int = 0
    extract_method: str = ""  # pdfplumber | pypdf | skip | failed
    kb_chunks: int = 0
    kg_equipment_entities: int = 0
    kg_fault_code_entities: int = 0
    kg_relationships: int = 0
    kg_proposals: int = 0
    kg_triples: int = 0
    quality_gate: str = "skipped"
    # Materialized Evidence receipt (step 6). `evidence_status` is the authoritative
    # surface for a receipt-write failure — deliberately NOT `errors`, because
    # `errors` drives the CLI exit code and a non-zero exit would make a cron treat
    # a successfully-ingested document as failed and retry it.
    evidence_status: str = "skipped (no registry configured)"
    evidence_datasets: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def print(self) -> None:
        w = 54
        print(f"\n{'═'*w}")
        print("INGEST PIPELINE REPORT")
        print(f"{'═'*w}")
        print(f"PDF:          {Path(self.pdf_path).name} ({self.pdf_bytes/1024/1024:.1f} MB)")
        print(f"Extract:      {self.extract_method} → {self.extract_chars:,} chars extracted")
        print(f"KB Chunks:    {self.kb_chunks} chunks created (2000 char, 200 overlap)")
        print(f"KG Entities:  {self.kg_equipment_entities} equipment, "
              f"{self.kg_fault_code_entities} fault codes")
        print(f"KG Relations: {self.kg_relationships} verified, "
              f"{self.kg_proposals} proposed (pending human review)")
        print(f"KG Triples:   {self.kg_triples} logged (source: manual_ingest)")
        print(f"Quality Gate: {self.quality_gate}")
        print(f"Evidence:     {self.evidence_status}")
        for dvid in self.evidence_datasets:
            print(f"                • {dvid}")
        if self.errors:
            print(f"\nErrors ({len(self.errors)}):")
            for e in self.errors:
                print(f"  • {e}")
        print(f"{'═'*w}\n")


# ---------------------------------------------------------------------------
# STEP 1: DOWNLOAD
# ---------------------------------------------------------------------------


_PDF_MAGIC = b"%PDF"
_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024  # 50 MB hard cap


def _validate_pdf(path: Path) -> bool:
    """Return True iff the file starts with PDF magic bytes."""
    try:
        with open(path, "rb") as f:
            return f.read(4) == _PDF_MAGIC
    except OSError:
        return False


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
                    if written > _MAX_DOWNLOAD_BYTES:
                        logger.error("Download aborted: exceeds 50 MB cap (%s)", url)
                        dest.unlink(missing_ok=True)
                        return False, 0
        if not _validate_pdf(dest):
            logger.error("Downloaded file is not a valid PDF (bad magic bytes): %s", dest.name)
            dest.unlink(missing_ok=True)
            return False, 0
        logger.info("Downloaded: %s (%s KB)", dest.name, written // 1024)
        return True, written
    except Exception as exc:
        logger.error("Download failed: %s", exc)
        dest.unlink(missing_ok=True)
        return False, 0


# ---------------------------------------------------------------------------
# STEP 2: EXTRACT TEXT (local — pdfplumber/pypdf, no external service)
# ---------------------------------------------------------------------------
# Docling was removed 2026-06-06 (OOM on the 8 GB VPS —
# docs/known-issues/2026-06-06-hub-upload-failures-docling-oom.md) but this
# pipeline kept POSTing to it, Connection-refusing on every manual. Extraction
# now runs in-process via ingest.pdf_extract (pdfplumber when available, pypdf
# fallback — the only PDF lib guaranteed on the ingest host). No socket opened.


def _ocr_extract(pdf_path: Path, report: PipelineReport) -> str:
    """OCR a no-text-layer PDF via Apache Tika (Tesseract). Fail-safe.

    `converter.extract_from_tika` already catches every exception (incl. Tika
    unreachable / timeout) and returns [] — so this never raises. Returns the
    joined OCR text, or "" when Tika is unavailable or produced nothing.
    """
    try:
        from ingest.converter import extract_from_tika
    except ImportError:
        from mira_crawler.ingest.converter import extract_from_tika

    try:
        data = pdf_path.read_bytes()
    except OSError as exc:
        report.errors.append(f"OCR: read failed: {exc}")
        return ""

    blocks = extract_from_tika(data)  # fail-safe: [] on unreachable/empty
    text = "\n\n".join(b["text"] for b in blocks if b.get("text"))
    if text:
        logger.info("OCR (Tika) extracted %d chars from %s", len(text), pdf_path.name)
    return text


def step_extract(pdf_path: Path, report: PipelineReport, ocr: bool = False) -> str:
    # Dual import path: `tasks.*` when mira-crawler is on sys.path (the cron),
    # `mira_crawler.*` when imported as a package — same idiom as tasks._shared.
    try:
        from ingest.pdf_extract import extract_pdf_text
    except ImportError:
        from mira_crawler.ingest.pdf_extract import extract_pdf_text

    size = pdf_path.stat().st_size
    if size >= LARGE_SKIP_BYTES:
        report.extract_method = "skip (>50 MB)"
        logger.warning("PDF too large to extract: %.1f MB", size / 1024 / 1024)
        return ""

    try:
        md, method = extract_pdf_text(pdf_path)
        if not md:
            # Scanned/image-only PDF — local extraction found no text layer.
            # With --ocr, fall back to Tika OCR before giving up (fail-safe).
            if ocr:
                ocr_text = _ocr_extract(pdf_path, report)
                if ocr_text:
                    report.extract_pages = ocr_text.count("\n\n") + 1
                    report.extract_chars = len(ocr_text)
                    report.extract_method = "tika_ocr"
                    return ocr_text
            report.extract_method = f"{method} (empty)"
            report.errors.append(f"Extract: {method} produced 0 chars")
            return ""
        report.extract_pages = md.count("\n# ") + md.count("\n## ") or 1
        report.extract_chars = len(md)
        report.extract_method = method
        logger.info("Extracted %d chars via %s", len(md), method)
        return md
    except Exception as exc:
        report.extract_method = "failed"
        report.errors.append(f"Extract: {exc}")
        logger.error("Extraction failed: %s", exc)
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


def _write_kg_edge(cur, source_id: str, target_id: str, relation_type: str,
                   report: PipelineReport, confidence: float = 1.0,
                   source_chunk_id: str | None = None,
                   source_description: str | None = None) -> None:
    """Create a KG edge from ingest. Default (#1662 / ADR-0017): PROPOSE it
    (relationship_proposals + ai_suggestions(kg_edge)) for human review —
    ingest never silently verifies. The legacy direct `kg_relationships`
    insert at confidence 1.0 runs ONLY when MIRA_KG_INGEST_AUTOVERIFY is
    deliberately set (one-time bulk migration / debug). Uses the caller's
    psycopg2 cursor so it sees the entities created earlier in the same
    transaction."""
    try:
        from ingest.proposal_writer import (
            autoverify_enabled,
            propose_relationship_cursor,
        )
    except ImportError:
        from mira_crawler.ingest.proposal_writer import (
            autoverify_enabled,
            propose_relationship_cursor,
        )

    if autoverify_enabled():
        cur.execute(
            """
            INSERT INTO kg_relationships
                (id, tenant_id, source_id, target_id, relationship_type, confidence)
            VALUES (%s, %s::uuid, %s::uuid, %s::uuid, %s, %s)
            ON CONFLICT (tenant_id, source_id, target_id, relationship_type) DO NOTHING
            """,
            (str(uuid.uuid4()), TENANT_ID, source_id, target_id,
             relation_type, confidence),
        )
        report.kg_relationships += 1
    else:
        pid = propose_relationship_cursor(
            cur,
            tenant_id=TENANT_ID,
            source_entity=source_id,
            target_entity=target_id,
            relation_type=relation_type,
            confidence=confidence,
            proposed_by="import:full_ingest",
            source_chunk_id=source_chunk_id,
            source_description=source_description,
        )
        if pid:
            report.kg_proposals += 1


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
                _write_kg_edge(cur, equip_id, manual_eid, "documented_in", report,
                               source_description=source_url)
                _log_triple(cur, f"{eff_mfr} {eff_model}", "documented_in",
                            f"{eff_mfr} {eff_model} — {manual_type}")
                report.kg_triples += 1
            except Exception as exc:
                logger.warning("KG edge (documented_in) failed: %s", exc)

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
                        _write_kg_edge(cur, equip_id, fc_id, "has_fault_code", report,
                                       source_description=source_url)
                    except Exception as exc:
                        logger.warning("KG edge (has_fault_code) failed: %s", exc)
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
# STEP 6: MATERIALIZED EVIDENCE RECEIPT (optional, fail-open)
# ---------------------------------------------------------------------------
# Records what this run actually discovered — byte identity of the PDF and the
# real extraction method — as a durable, typed, `candidate` receipt (ADR-0029,
# `.claude/rules/materialized-evidence.md`). A receipt is a POINTER: it references
# the raw PDF and the `knowledge_entries` chunks this run already created, and
# stores no document text.
#
# Boundaries this step does NOT cross:
#   • it never decides to SKIP extraction (no `resolve_recall` call) — writing a
#     receipt is purely additive, so it cannot turn a failed extraction into a
#     success or retry a quarantined document;
#   • it never promotes anything (trust stays candidate, approval pending);
#   • it never blocks KB ingest — every failure lands in `report.evidence_status`.


def evidence_repair_path(registry_path: str) -> Path:
    """The repair journal that sits beside a registry snapshot."""
    return Path(registry_path + ".repair.jsonl")


def _journal_lock_path(journal: Path) -> Path:
    """The journal's OWN lock — deliberately not the registry's.

    Both the append and the rewrite take this one, and the rewrite then calls
    ``write_receipt`` → ``FileRegistry.register``, which takes
    ``<snapshot>.lock``. ``flock`` is per-open-file-description, so sharing one
    path between the two would make the process block on itself forever — the
    exact deadlock that deleted ``print_recall``'s wrapper.
    """
    return Path(str(journal) + ".lock")


@contextmanager
def _journal_locked(journal: Path):
    """Serialize journal writers; degrade to unlocked if the primitive is absent.

    The evidence contract is an optional dependency of this pipeline (every
    import of it is guarded), so a missing package must not turn journalling —
    the thing that records a gap — into the gap.
    """
    try:
        from materialized_evidence.backends.file_registry import exclusive_file_lock
    except ImportError:
        yield
        return
    with exclusive_file_lock(_journal_lock_path(journal)):
        yield


def _scrub_uris(text: str) -> str:
    """Redact any network URI inside a free-text string (an exception message).

    An exception raised while writing a receipt can quote the fetch URL, and both
    the pipeline's stdout report and the repair journal are durable surfaces the
    cron persists. The URL's credentials must not ride along into either.

    Delegates to `materialized_evidence.scrub_text_uris` — a regex over the prose,
    not a split on spaces: a URL in a message is routinely quoted or comma-trailed
    (`cannot open 'https://…?token=…'`), and those tokens do not parse as a URI, so
    a per-token pass returns them untouched.
    """
    try:
        from materialized_evidence import scrub_text_uris
    except ImportError:
        return text
    return scrub_text_uris(text)


def _record_evidence_repair_item(
    *,
    registry_path: str,
    reason: str,
    tenant_id: str,
    environment: str,
    pdf_path: Path,
    source_url: str,
    replay_inputs: dict | None,
) -> str:
    """Append an ``evidence_pending`` repair item; return its journal path (or "").

    **Why this exists.** A receipt failure is deliberately kept out of
    ``report.errors`` — ``errors`` drives the CLI exit code, and a non-zero exit
    would make the KB-growth cron treat a document that ingested perfectly as
    failed and re-download it. But that fail-open left no trace: the process exited
    zero, the scheduler marked the document done, and a document with no evidence
    receipt was indistinguishable from one with two. The journal is the missing
    half — ingest still succeeds, and the gap is now *recorded* instead of lost.

    The item carries the compiler's inputs verbatim, so replaying it needs neither
    the network nor a re-extraction: byte identity, byte count, the real extraction
    method and its char/text hashes, and the materializations this run produced.
    Recovery is ``compile_document_evidence(**item) → write_receipt``.

    ``source_uri`` is **redacted** (`materialized_evidence.redaction`) before it is
    journaled. This file is exactly as durable as the registry snapshot, so the
    presigned-link / ``?token=`` exposure that made raw URLs unfit for a manifest
    makes them unfit here too.

    Never raises: a failure to record the failure must not break document ingest.
    """
    if not registry_path:
        return ""
    try:
        from materialized_evidence import redact_uri

        journal = evidence_repair_path(registry_path)
        item = {
            "schema": "evidence_repair_item/1.0",
            "status": "evidence_pending",
            "at": _utc_now(),
            "reason": reason,
            "tenant_id": tenant_id,
            "environment": environment,
            "registry_path": registry_path,
            "source_uri": redact_uri(source_url),
            "local_path": str(pdf_path),
            # None when the failure happened before the inputs were assembled (e.g.
            # the PDF could not be re-read) — the item is still recorded, because a
            # gap you cannot yet replay is still a gap you must know about.
            "replay": _redact_replay(replay_inputs, redact_uri),
        }
        journal.parent.mkdir(parents=True, exist_ok=True)
        # One JSON object per line, opened O_APPEND: a single short line lands
        # whole even with two pipeline processes writing concurrently. The lock
        # covers the OTHER writer — `replay_evidence_journal` rewrites this file
        # whole, and an O_APPEND write racing that rewrite lands in the replaced
        # inode and is lost. Losing the record of a lost receipt is precisely the
        # failure this journal exists to end.
        with _journal_locked(journal):
            with open(journal, "a", encoding="utf-8") as f:
                f.write(json.dumps(item, sort_keys=True, ensure_ascii=False) + "\n")
        return str(journal)
    except Exception as exc:  # noqa: BLE001 — recording a failure must never fail loudly
        logger.warning("Could not record evidence repair item: %s", exc)
        return ""


def _redact_replay(replay: dict | None, redact_uri) -> dict | None:
    if not replay:
        return None
    out = json.loads(json.dumps(replay))
    src = out.get("source") or {}
    if "source_uri" in src:
        src["source_uri"] = redact_uri(src["source_uri"])
    for m in out.get("materializations") or []:
        if isinstance(m.get("locator"), str):
            m["locator"] = redact_uri(m["locator"])
    return out


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Repair-journal replay — the operator path that turns a recorded gap into a receipt
# ---------------------------------------------------------------------------
#
# Journalling a failure only records the gap; it does not close it. This is the
# consumer: it reconstructs the compiler's inputs FROM THE JOURNAL and nothing
# else — no download, no OCR, no embedding, no re-extraction — so replaying is
# cheap, offline, and safe to run on a document whose PDF has since been deleted.
#
# Run it after fixing whatever broke the write (a full disk, a read-only mount):
#     python3 mira-crawler/tasks/full_ingest_pipeline.py \
#         --replay-evidence-journal /var/lib/mira/evidence.json
#
# Every entry gets a durable outcome written back into the journal. Nothing is
# discarded — not a malformed line, not an entry that can never be replayed.

_REPLAY_SCHEMA = "evidence_repair_item/1.0"
_STATUS_PENDING = "evidence_pending"
_STATUS_REPLAYED = "replayed"
_STATUS_BLOCKED = "blocked"

# A contract violation in the stored payload can never succeed on a retry, so it
# is BLOCKED (a human must look). Anything else — a full disk, a read-only mount,
# a permission — is transient: the entry stays `evidence_pending` and the next
# run picks it up again.
_PERMANENT_ERRORS = ("DocumentCompilerError", "RegistryError", "TypeError", "ValueError", "KeyError")


@dataclass
class ReplayReport:
    """What one replay pass did. Printed by the CLI; returned to callers."""

    journal: str = ""
    total: int = 0
    replayed: int = 0
    already_replayed: int = 0
    blocked: int = 0
    pending: int = 0
    malformed: int = 0
    dataset_versions: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def needs_attention(self) -> bool:
        """Blocked/malformed entries need a human. Pending ones just need a retry."""
        return bool(self.blocked or self.malformed)

    def summary(self) -> str:
        return (
            f"evidence journal {self.journal or '(none)'}: {self.total} entr(ies) — "
            f"{self.replayed} replayed, {self.already_replayed} already replayed, "
            f"{self.pending} still pending, {self.blocked} blocked, "
            f"{self.malformed} malformed"
        )


def _replay_one(item: dict, default_registry: str) -> tuple[dict, str]:
    """Replay one pending entry. Returns ``(updated_item, outcome)``.

    Reconstructs ``DocumentSource`` / ``DocumentExtraction`` / ``MaterializationRef``
    from the stored payload alone — the document itself is never touched, which is
    what makes replay free and what makes it work after the PDF is gone.

    Idempotent by construction: identical inputs compile to the same
    ``dataset_version_id`` and ``manifest_hash``, and ``register`` is a no-op on an
    identical hash (ADR A3). A second replay therefore adds no manifest version —
    and the ``replayed`` status this writes back means it is not even attempted.
    """
    from materialized_evidence import Environment
    from materialized_evidence.backends.file_registry import FileRegistry
    from materialized_evidence.document_compiler import (
        DocumentExtraction,
        DocumentSource,
        MaterializationRef,
        compile_document_evidence,
        write_receipt,
    )

    replay = item.get("replay")
    if not isinstance(replay, dict):
        # `replay` is None when the failure happened before the inputs were
        # assembled. The gap is real and stays recorded — but no amount of retrying
        # reconstructs a receipt from inputs that were never captured.
        return _blocked(item, "no replay payload recorded — the receipt cannot be "
                              "reconstructed without re-reading the document")

    registry_path = item.get("registry_path") or default_registry
    if not registry_path:
        return _blocked(item, "no registry_path on the entry and none supplied")

    receipt = compile_document_evidence(
        source=DocumentSource(**replay["source"]),
        extraction=DocumentExtraction(**replay["extraction"]),
        tenant_id=item["tenant_id"],
        environment=Environment(item["environment"]),
        # No verified pages, for the same reason the original run had none: this
        # extraction layer supplies no page identity. Replay reproduces the
        # original receipt; it never enriches it.
        verified_pages=None,
        materializations=[MaterializationRef(**m) for m in replay.get("materializations") or []],
    )
    versions = write_receipt(receipt, FileRegistry(registry_path))
    updated = dict(item)
    updated.update(
        status=_STATUS_REPLAYED,
        replayed_at=_utc_now(),
        dataset_version_ids=versions,
        registry_path=registry_path,
    )
    updated.pop("last_replay_error", None)
    return updated, _STATUS_REPLAYED


def _blocked(item: dict, reason: str) -> tuple[dict, str]:
    updated = dict(item)
    updated.update(status=_STATUS_BLOCKED, blocked_at=_utc_now(), blocked_reason=_scrub_uris(reason))
    return updated, _STATUS_BLOCKED


def replay_evidence_journal(registry_path: str, *, journal_path: str | None = None) -> ReplayReport:
    """Replay every ``evidence_pending`` entry in a repair journal. No network, no
    extraction, no document read.

    The whole pass runs under the journal's own lock and rewrites the file
    atomically (tmp + fsync + replace), so a crash mid-rewrite cannot destroy the
    only record of the gap, and a pipeline appending concurrently is not lost.

    Unparseable lines are preserved BYTE-IDENTICAL rather than reformatted or
    dropped — a line this code cannot read is exactly the line a human must see.
    """
    journal = Path(journal_path) if journal_path else evidence_repair_path(registry_path)
    report = ReplayReport(journal=str(journal))
    if not journal.exists():
        report.notes.append("no repair journal — nothing to replay")
        return report

    with _journal_locked(journal):
        out_lines: list[str] = []
        for raw in journal.read_text("utf-8").splitlines():
            if not raw.strip():
                continue
            report.total += 1
            try:
                item = json.loads(raw)
                if not isinstance(item, dict):
                    raise ValueError("journal entry is not a JSON object")
            except Exception as exc:  # noqa: BLE001 — a bad line is kept, never dropped
                report.malformed += 1
                report.notes.append(f"malformed entry preserved verbatim: {exc}")
                out_lines.append(raw)  # byte-identical
                continue

            status = item.get("status")
            if status == _STATUS_REPLAYED:
                report.already_replayed += 1
                out_lines.append(_dump(item))
                continue
            if status != _STATUS_PENDING:
                report.blocked += 1
                report.notes.append(f"entry with unrecognised status {status!r} left untouched")
                out_lines.append(_dump(item))
                continue
            if item.get("schema") != _REPLAY_SCHEMA:
                updated, _ = _blocked(item, f"unsupported schema {item.get('schema')!r}")
                report.blocked += 1
                out_lines.append(_dump(updated))
                continue

            try:
                updated, outcome = _replay_one(item, registry_path)
            except Exception as exc:  # noqa: BLE001 — one bad entry must not abort the pass
                reason = _scrub_uris(f"{type(exc).__name__}: {exc}")
                if type(exc).__name__ in _PERMANENT_ERRORS:
                    updated, outcome = _blocked(item, reason)
                else:
                    # Transient: stay pending so the next run retries, but record
                    # WHY, so a gap that never clears is visible rather than quiet.
                    updated = dict(item)
                    updated.update(last_replay_error=reason, last_replay_at=_utc_now())
                    outcome = _STATUS_PENDING
                report.notes.append(f"{outcome}: {reason}")

            if outcome == _STATUS_REPLAYED:
                report.replayed += 1
                report.dataset_versions.extend(updated.get("dataset_version_ids") or [])
            elif outcome == _STATUS_BLOCKED:
                report.blocked += 1
            else:
                report.pending += 1
            out_lines.append(_dump(updated))

        _atomic_write_lines(journal, out_lines)
    return report


def _dump(item: dict) -> str:
    return json.dumps(item, sort_keys=True, ensure_ascii=False)


def _atomic_write_lines(path: Path, lines: list[str]) -> None:
    """tmp + fsync + replace — the same idiom ``FileRegistry._persist`` uses.

    An in-place rewrite that dies halfway destroys the only durable record of
    every gap the journal holds.
    """
    tmp = path.with_suffix(path.suffix + ".tmp")
    payload = ("\n".join(lines) + "\n" if lines else "").encode("utf-8")
    with open(tmp, "wb") as f:
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def step_document_evidence(
    pdf_path: Path,
    text: str,
    source_url: str,
    ocr_requested: bool,
    report: PipelineReport,
    registry_path: str = "",
    environment: str = "dev",
    tenant_id: str | None = None,
) -> None:
    # `tenant_id` is an explicit parameter (defaulting to the module global) rather
    # than read straight from `TENANT_ID`: `test_celery_app_resilient_imports`
    # deletes every `sys.modules["tasks.*"]` entry, so a later
    # `patch("tasks.full_ingest_pipeline.TENANT_ID")` would patch a re-imported
    # module while this function's globals stayed on the orphaned original.
    tid = TENANT_ID if tenant_id is None else tenant_id
    if not registry_path:
        report.evidence_status = "skipped (no registry configured)"
        return
    if not tid:
        report.evidence_status = "skipped (MIRA_TENANT_ID not set — evidence is tenant-scoped)"
        return

    replay_inputs: dict | None = None
    try:
        from materialized_evidence import Environment, sha256_bytes
        from materialized_evidence.backends.file_registry import FileRegistry
        from materialized_evidence.document_compiler import (
            DocumentExtraction,
            DocumentSource,
            MaterializationRef,
            compile_document_evidence,
            write_receipt,
        )
    except ImportError as exc:
        report.evidence_status = f"skipped (evidence contract unavailable: {exc})"
        return

    try:
        try:
            env = Environment(environment)
        except ValueError:
            report.evidence_status = f"skipped (unknown MIRA_EVIDENCE_ENV {environment!r})"
            return

        raw = pdf_path.read_bytes()
        doc_sha = sha256_bytes(raw)  # byte identity — never the URL/filename
        source = DocumentSource(
            source_uri=source_url,
            content_sha256=doc_sha,
            byte_count=len(raw),
            local_path=str(pdf_path),
        )
        extraction = DocumentExtraction(
            method=report.extract_method,  # verbatim: pdfplumber | pypdf | tika_ocr | …
            char_count=len(text),
            text_sha256=sha256_bytes(text.encode("utf-8")) if text else None,
            extractor_version=None,  # the extraction layer reports none — unknown, not guessed
            ocr_requested=ocr_requested,
            size_limit_bytes=LARGE_SKIP_BYTES,
        )

        # Only materializations this run genuinely produced. On a failed extraction
        # this list is empty, so the receipt claims nothing that does not exist.
        materializations: list[MaterializationRef] = []
        if report.kb_chunks:
            materializations.append(
                MaterializationRef(
                    kind="knowledge_entries",
                    # Content-addressed, NOT `source_url=…`. A download URL is often a
                    # credential (presigned signature, `?token=`), and an index_ref is
                    # persisted verbatim into the registry snapshot. The document SHA
                    # identifies the same chunks without carrying one, and matches the
                    # compiler's own record locators.
                    locator=f"sha256:{doc_sha}",
                    record_count=report.kb_chunks,
                )
            )
        txt_sidecar = pdf_path.with_suffix(".txt")
        if text and txt_sidecar.exists():
            materializations.append(
                MaterializationRef(kind="text_sidecar", locator=str(txt_sidecar))
            )

        # Everything the compiler needs, captured BEFORE the call that can fail —
        # so a repair item can replay the receipt without re-downloading or
        # re-extracting the document. See `_record_evidence_repair_item`.
        replay_inputs = {
            "source": {
                "source_uri": source.source_uri,
                "content_sha256": doc_sha,
                "byte_count": len(raw),
                "local_path": str(pdf_path),
            },
            "extraction": {
                "method": extraction.method,
                "char_count": extraction.char_count,
                "text_sha256": extraction.text_sha256,
                "extractor_version": extraction.extractor_version,
                "ocr_requested": extraction.ocr_requested,
                "size_limit_bytes": extraction.size_limit_bytes,
            },
            "materializations": [
                {"kind": m.kind, "locator": m.locator, "record_count": m.record_count}
                for m in materializations
            ],
        }

        receipt = compile_document_evidence(
            source=source,
            extraction=extraction,
            tenant_id=tid,
            environment=env,
            # No verified pages: this extraction layer supplies no page identity, and
            # `report.extract_pages` is a markdown-heading ESTIMATE, not provenance.
            verified_pages=None,
            materializations=materializations,
        )
        report.evidence_datasets = write_receipt(receipt, FileRegistry(registry_path))
        report.evidence_status = (
            f"{len(report.evidence_datasets)} candidate receipt(s) → {registry_path}"
        )
        logger.info("Evidence: %s", report.evidence_status)
    except Exception as exc:  # noqa: BLE001 — fail-open: ingest already succeeded
        reason = _scrub_uris(f"{type(exc).__name__}: {exc}")
        repair = _record_evidence_repair_item(
            registry_path=registry_path,
            reason=reason,
            tenant_id=tid,
            environment=environment,
            pdf_path=pdf_path,
            source_url=source_url,
            replay_inputs=replay_inputs,
        )
        report.evidence_status = (
            f"failed: {reason}" + (f" — repair item recorded → {repair}" if repair else "")
        )
        logger.warning("Evidence receipt failed (document ingest unaffected): %s", reason)


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
        summary = next((line for line in lines if "GATE" in line and ("PASS" in line or "FAIL" in line)), "")
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
    ocr: bool = False,
    evidence_registry: str | None = None,
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
    text = step_extract(dest, report, ocr=ocr)
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

    # 6. Materialized Evidence receipt (optional; runs after KB+KG so it can
    #    reference the knowledge_entries materialization this run produced, and on
    #    the failed-extraction path so a failure is recorded rather than re-paid).
    step_document_evidence(
        dest,
        text,
        pdf_url,
        ocr,
        report,
        registry_path=(evidence_registry if evidence_registry is not None else EVIDENCE_REGISTRY),
        environment=EVIDENCE_ENV,
        tenant_id=TENANT_ID,
    )

    # 5. Quality gate
    if not no_quality_gate:
        step_quality_gate(baseline_path, report)

    report.print()
    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="MIRA full KB ingest pipeline")
    # Not `required=True`: `--replay-evidence-journal` is a second mode that takes
    # none of these. The ingest args are validated after parsing (see `main`), so
    # the cron's existing argv shape is unchanged and a missing one still errors.
    p.add_argument("--pdf-url", help="Direct PDF download URL")
    p.add_argument("--manufacturer", help="Manufacturer name (e.g. Allen-Bradley)")
    p.add_argument("--model", help="Model number (e.g. 1606-XLS)")
    p.add_argument("--type", dest="manual_type", default="equipment_manual",
                   help="Manual type (default: equipment_manual)")
    p.add_argument("--baseline", default=None,
                   help="Path to kb_quality_gate baseline JSON (enables gate comparison)")
    p.add_argument("--no-quality-gate", action="store_true",
                   help="Skip quality gate step entirely")
    p.add_argument("--ocr", action="store_true",
                   help="Fall back to Tika OCR when local extraction finds no "
                        "text layer (scanned/image-only PDFs). Requires TIKA_URL.")
    p.add_argument("--evidence-registry", default=None,
                   help="Path to a Materialized Evidence JSON snapshot. When set, "
                        "write a candidate document-evidence receipt (byte identity "
                        "+ real extraction method) after ingest. Optional and "
                        "fail-open — omit (or MIRA_EVIDENCE_REGISTRY) and ingest "
                        "behaves exactly as before. Concurrent runs may share one "
                        "snapshot: writes take an exclusive lock on <snapshot>.lock "
                        "and re-read before mutating. A receipt failure never fails "
                        "the ingest; it is journaled to <snapshot>.repair.jsonl.")
    p.add_argument("--replay-evidence-journal", metavar="SNAPSHOT", default=None,
                   help="Operator repair mode: replay <SNAPSHOT>.repair.jsonl into "
                        "<SNAPSHOT> and exit. Reconstructs each pending receipt from "
                        "the journal alone — no download, no OCR, no embedding, no "
                        "re-extraction — so it is safe to run after the PDF is gone. "
                        "Idempotent: an entry already replayed is skipped. Exits "
                        "non-zero only when entries are BLOCKED (a human must look); "
                        "an entry left pending is retryable and exits zero.")
    args = p.parse_args(argv)
    if not args.replay_evidence_journal:
        missing = [
            f"--{name.replace('_', '-')}"
            for name in ("pdf_url", "manufacturer", "model")
            if not getattr(args, name)
        ]
        if missing:
            p.error(f"the following arguments are required: {', '.join(missing)}")
    return args


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns the process exit code rather than exiting.

    One exception, and it is argparse's: a usage error (a missing required
    argument) raises ``SystemExit(2)`` from ``_parse_args`` before this function
    can return anything — the standard CLI contract, asserted by a test.
    """
    args = _parse_args(argv)

    if args.replay_evidence_journal:
        report = replay_evidence_journal(args.replay_evidence_journal)
        print(report.summary())
        for note in report.notes:
            print(f"  • {note}")
        for dvid in report.dataset_versions:
            print(f"  ✓ {dvid}")
        # Blocked/malformed entries need a human; a still-pending one only needs
        # the next run, and must not make a scheduler treat the pass as failed.
        return 1 if report.needs_attention else 0

    result = run(
        pdf_url=args.pdf_url,
        manufacturer=args.manufacturer,
        model=args.model,
        manual_type=args.manual_type,
        baseline_path=args.baseline,
        no_quality_gate=args.no_quality_gate,
        ocr=args.ocr,
        evidence_registry=args.evidence_registry,
    )
    return 1 if result.errors else 0


if __name__ == "__main__":
    sys.exit(main())
