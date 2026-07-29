"""Formal recall gate for the paid PrintSense interpretation (PR G).

The paid ``interpret_print`` call (~$0.36 on gpt-5.5) is the one PrintSense stage
with NO recall on the CLI path — an identical print re-pays the vision model every
time. This bridge wraps it with the Materialized Evidence recall contract
(``resolve_recall`` + a durable registry): an identical print (same page bytes +
model/prompt/producer version) is interpreted ONCE, materialized as a typed
``EvidenceManifest`` (cost / trust / lineage), stored in a durable registry + the
PrintSense CAS, and recalled thereafter with **no model call**.

This is a read-only *optimization* over the existing ``interpret_print`` seam
(``.claude/rules/fast-path-optimization.md``): it reuses that seam verbatim, adds
no second resolver/normalizer, and on ANY registry/CAS error **falls through to a
plain interpretation** — a recall bug can never break a print interpretation. It
writes evidence records (materialization) but performs no control writes.

By default the recall key **excludes** the technician question (the CLI treats the
PrintSynthGraph as a complete, question-independent interpretation and reuses it
across questions). The production path, where the paid prompt IS shaped by the
question + OCR/package context, passes those inputs through ``producer_extra`` so
the key covers every graph-affecting input — a behavior-preserving gate that never
serves a graph computed for one question/context in answer to another.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass

from materialized_evidence import (
    DatasetType,
    Environment,
    EvidenceManifest,
    EvidenceRecord,
    RecallOutcome,
    RecallQuery,
    StageStatus,
    TrustStatus,
    content_hash,
    resolve_recall,
    with_hashes,
)
from materialized_evidence.registry import MaterializationRegistry

from .cas import CAS, sha256_bytes
from .interpret import DEFAULT_MODEL, PROVIDER, interpret_print, pop_last_usage
from .models import PrintSynthGraph

logger = logging.getLogger("printsense.recall")

SCHEMA_NAME = "PrintSynthGraph"
PROMPT_CONTRACT_VERSION = "printsynth-system-v1"
# Producer cache version — **BUMP whenever a graph-affecting change is made to the paid
# interpreter contract**: the system/user prompt, preprocessing, the model-call shape, or
# how pages are packaged. Bumping invalidates all prior recall entries, so a changed
# producer never serves a stale graph. Distinct from PROMPT_CONTRACT_VERSION (recorded on
# the manifest as lineage) and _schema_version() (which auto-tracks the output schema).
PRODUCER_CACHE_VERSION = "v1"
PRODUCER_NAME = "printsense.interpret.interpret_print"
_CAS_KIND = "printsynth"
_STORAGE_PREFIX = f"printsense-cas:{_CAS_KIND}:"


@dataclass(frozen=True)
class RecallInfo:
    """What the recall wrapper did — for the CLI to report and for tests to assert."""

    outcome: str  # a RecallOutcome value
    recalled: bool  # True == returned a stored graph (no model call)
    dataset_version_id: str | None = None
    avoided_compute_ms: int | None = None  # on a hit: cost we did NOT pay again
    avoided_cost_usd: float | None = None


def lookup_recall(
    pages: list[tuple[bytes, str]],
    *,
    registry: MaterializationRegistry,
    cas: CAS,
    tenant_id: str = "local",
    environment: Environment = Environment.DEV,
    model: str = DEFAULT_MODEL,
    preprocess: bool = True,
    producer_extra: str | None = None,
) -> tuple[PrintSynthGraph, RecallInfo] | None:
    """Return a stored ``(graph, RecallInfo)`` for an EXACT recall hit, else ``None``.

    The recall-only half of :func:`interpret_print_with_recall`: it never computes and
    never catches — the caller decides how a lookup error falls through (the bridge
    logs + computes; the production gate logs ``PRINT_RECALL_LOOKUP_FAILED`` + computes).
    This lets the production gate do a lockless first lookup + a per-key double-check
    without paying the model on a miss.
    """
    page_hashes = sorted(sha256_bytes(data) for data, _mt in pages)
    query = RecallQuery(
        tenant_id=tenant_id,
        dataset_type=DatasetType.PRINT_INTERPRETATION,
        source_hashes=page_hashes,
        required_schema=(SCHEMA_NAME, _schema_version()),
        allowed_producer_versions=[_producer_version(model, preprocess, producer_extra)],
        environment=environment,
    )
    result = resolve_recall(query, registry)
    if result.outcome != RecallOutcome.EXACT or not result.selected_versions:
        return None
    dvid = result.selected_versions[0]
    m = registry.get(dvid, tenant_id=tenant_id)
    if m is None or not m.storage_ref:
        return None
    graph = _load_graph(cas, m.storage_ref)
    logger.info(
        "PRINT_RECALL_HIT dvid=%s avoided_compute_ms=%s avoided_cost_usd=%s",
        dvid,
        m.compute_time_ms,
        m.provider_cost_usd,
    )
    return graph, RecallInfo(
        outcome=result.outcome.value,
        recalled=True,
        dataset_version_id=dvid,
        avoided_compute_ms=m.compute_time_ms,
        avoided_cost_usd=m.provider_cost_usd,
    )


def interpret_print_with_recall(
    pages: list[tuple[bytes, str]],
    *,
    registry: MaterializationRegistry,
    cas: CAS,
    tenant_id: str = "local",
    environment: Environment = Environment.DEV,
    question: str | None = None,
    model: str = DEFAULT_MODEL,
    preprocess: bool = True,
    producer_extra: str | None = None,
    interpret_fn=None,
) -> tuple[PrintSynthGraph, RecallInfo]:
    """Interpret ``pages``, reusing prior evidence when the same print was already
    interpreted by the same producer. Returns ``(graph, RecallInfo)``.

    ``interpret_fn`` defaults to the real (paid) ``interpret_print``; inject a fake
    in tests to keep the whole path free.

    ``producer_extra`` (optional) folds extra graph-affecting inputs into the recall
    key — the production caller passes ``canonical_json({question, package_context})``
    so recall is behavior-preserving. ``None`` (the CLI default) keeps the legacy
    page-only key unchanged.
    """
    page_hashes = sorted(sha256_bytes(data) for data, _mt in pages)
    producer_version = _producer_version(model, preprocess, producer_extra)
    schema_version = _schema_version()

    # 1) recall attempt — a lookup error must never break interpretation.
    try:
        hit = lookup_recall(
            pages,
            registry=registry,
            cas=cas,
            tenant_id=tenant_id,
            environment=environment,
            model=model,
            preprocess=preprocess,
            producer_extra=producer_extra,
        )
        if hit is not None:
            return hit
    except Exception:
        logger.warning("recall lookup failed; computing fresh", exc_info=True)

    # 2) compute (cache miss, or the lookup fell through) — pay once, then materialize.
    fn = interpret_fn if interpret_fn is not None else interpret_print
    t0 = time.perf_counter()
    graph = fn(pages, question=question, model=model, preprocess=preprocess)
    compute_ms = int((time.perf_counter() - t0) * 1000)

    info = RecallInfo(outcome=RecallOutcome.NONE.value, recalled=False)
    try:
        dvid = _materialize(
            graph,
            registry=registry,
            cas=cas,
            tenant_id=tenant_id,
            environment=environment,
            page_hashes=page_hashes,
            producer_version=producer_version,
            schema_version=schema_version,
            model=model,
            compute_ms=compute_ms,
        )
        info = RecallInfo(outcome=RecallOutcome.NONE.value, recalled=False, dataset_version_id=dvid)
    except Exception:
        logger.warning("materialize failed; returning computed graph uncached", exc_info=True)
    return graph, info


# ── helpers ──────────────────────────────────────────────────────────────────


def _schema_version() -> str:
    """Self-maintaining schema version: any change to the PrintSynth schema changes
    this, so ``resolve_recall`` (Gate 3) recomputes on schema drift automatically."""
    schema = json.dumps(PrintSynthGraph.model_json_schema(), sort_keys=True, separators=(",", ":"))
    return sha256_bytes(schema.encode("utf-8"))[:12]


def canonical_json(obj) -> str:
    """Deterministic JSON for recall keys: sorted mapping keys, preserved list
    order, preserved unicode (no ``\\uXXXX`` escapes), preserved ``null``, and
    compact separators. Equal inputs always serialize equal; unequal inputs never
    collide on formatting alone. The production caller folds the question +
    package context through this into ``producer_extra``."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _producer_version(model: str, preprocess: bool, extra: str | None = None) -> str:
    # Base (``extra=None``) is the CLI's question-independent key: the same print
    # reuses one graph across questions. Bumping the trailing version invalidates
    # recall when the preprocess/producer contract changes.
    base = f"{PROVIDER}|{model}|pp={int(preprocess)}|{PRODUCER_CACHE_VERSION}"
    # ``extra`` folds the caller's graph-affecting inputs (the production path
    # passes canonical(question + package_context)) into the key so a graph
    # computed for one question/context is never served for another.
    if extra:
        base = f"{base}|x={sha256_bytes(extra.encode('utf-8'))[:16]}"
    return base


def _load_graph(cas: CAS, storage_ref: str) -> PrintSynthGraph:
    key = storage_ref.rsplit(":", 1)[-1]
    return PrintSynthGraph.model_validate_json(cas.get(_CAS_KIND, key).decode("utf-8"))


def _materialize(
    graph: PrintSynthGraph,
    *,
    registry: MaterializationRegistry,
    cas: CAS,
    tenant_id: str,
    environment: Environment,
    page_hashes: list[str],
    producer_version: str,
    schema_version: str,
    model: str,
    compute_ms: int,
) -> str:
    graph_json = graph.model_dump_json().encode("utf-8")
    cas_key = cas.put(graph_json, _CAS_KIND)
    storage_ref = f"{_STORAGE_PREFIX}{cas_key}"

    # deterministic identity (no RNG): re-materializing identical output is idempotent
    dataset_id = sha256_bytes(
        "|".join([*page_hashes, producer_version, SCHEMA_NAME]).encode("utf-8")
    )[:16]
    record = EvidenceRecord(
        record_id=cas_key,
        dataset_id=dataset_id,
        source_locator=",".join(page_hashes),
        payload=json.loads(graph_json),
        producer=PRODUCER_NAME,
    )
    # compute the content hash first so the version id embeds it and with_hashes
    # stamps manifest_hash over the FINAL id (resolver Gate 6 integrity check).
    ch = content_hash([record])
    dataset_version_id = f"{dataset_id}@{ch[:12]}"

    usage = pop_last_usage() or {}
    provider = usage.get("provider")
    manifest = EvidenceManifest(
        dataset_id=dataset_id,
        dataset_version_id=dataset_version_id,
        dataset_type=DatasetType.PRINT_INTERPRETATION,
        schema_name=SCHEMA_NAME,
        schema_version=schema_version,
        tenant_id=tenant_id,
        environment=environment,
        source_hashes=page_hashes,
        producer_name=PRODUCER_NAME,
        producer_version=producer_version,
        model_provider=provider,
        model_id=(usage.get("model") or model) if provider else None,
        prompt_contract_version=PROMPT_CONTRACT_VERSION if provider else None,
        storage_ref=storage_ref,
        stage_status=StageStatus.COMPLETE,
        trust_status=TrustStatus.CANDIDATE,  # nothing self-promotes to trusted
        compute_time_ms=compute_ms,
        model_input_units=usage.get("input_tokens"),
        model_output_units=usage.get("output_tokens"),
        provider_cost_usd=_estimate_cost(usage),
    )
    manifest = with_hashes(manifest, [record])
    registry.register(manifest)
    logger.info("PRINT_MATERIALIZED dvid=%s compute_ms=%s", dataset_version_id, compute_ms)
    return dataset_version_id


def _estimate_cost(usage: dict) -> float | None:
    """Approximate provider cost from token usage IF a per-Mtoken rate is configured
    (``PRINT_VISION_COST_PER_MTOK_OUT`` / ``..._IN``). No fabricated list prices —
    without a configured rate this is ``None`` and the token counts + measured
    ``compute_time_ms`` carry the 'what recall avoided' story instead."""
    out = usage.get("output_tokens")
    rate_out = os.getenv("PRINT_VISION_COST_PER_MTOK_OUT")
    if not out or not rate_out:
        return None
    try:
        out_rate = float(rate_out)
        in_rate = float(os.getenv("PRINT_VISION_COST_PER_MTOK_IN") or "0")
    except ValueError:
        return None
    inp = usage.get("input_tokens") or 0
    return round(out / 1_000_000 * out_rate + inp / 1_000_000 * in_rate, 6)
