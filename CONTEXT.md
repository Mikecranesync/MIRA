# MIRA — Domain Glossary

> Living glossary of the terms MIRA uses internally. Implementation-free.
> When code or chat conflicts with a term defined here, treat this file as
> authoritative until the user updates it.

## Ingestion

**Drop** — A source artifact (PDF today; images later) placed in `~/MiraDrop/inbox/`
for unattended ingestion. Identified by SHA-256 of the original file's bytes;
re-dropping the same file is a no-op (idempotent).

**Logical document** — One Drop = one logical document. Even if the file's text
is later split into many chunks, those chunks reassemble to one document
identity (one `uploads` row, one source citation, one KG attribution target).
Physical PDF splitting is rejected as a design — see ADR-pending.

**Chunk** — A section-aware, page-anchored slice of a logical document's text.
Chunks carry: `doc_id`, `page_start/page_end`, `section_path`, `text`,
`embedding`. They are the unit of retrieval and the unit of evidence cited
back to a technician.

## Knowledge surfaces

**KB (Knowledge Base)** — The retrievable store of chunks. For MiraDrop, the
KB is Neon `knowledge_entries` via mira-ingest-v2 (not Open WebUI).
Answers the question "what does the source say about X?".

**mira-ingest-v2** — The ingest service used by MiraDrop. Replaces Open WebUI
chunking on this path. Pipeline: docling-convert → section-aware chunk →
embed → write `knowledge_entries` + propose KG facts. Output chunks carry
`doc_id`, `page_start/page_end`, `section_path` so KG evidence and
technician citations can point at the right page.

**Ingest gateway** — Hub is the gateway in front of mira-ingest-v2. It owns
auth, tenant resolution, and the `uploads` table-of-record. Hub streams the
request body straight through to v2 (no in-memory buffering). v2 has no
public surface and no auth of its own.

**Ingest job** — A unit of work inside mira-ingest-v2. v2's HTTP endpoint
accepts the streamed body, writes the file to disk, inserts an `uploads`
row with `status=queued`, returns 202 immediately. A separate single-slot
worker process advances the row through `parsing → embedding →
kg_proposing → parsed` (or `failed`). HTTP never waits on docling. The
watcher polls Hub's `/api/uploads/:id` for terminal state, same shape it
already uses today.

**Ingest queue** — The `hub_uploads` row IS the queue. No separate queue
table. v2's worker holds rows with `FOR UPDATE SKIP LOCKED WHERE
ingest_route='v2' AND status='queued'`. The same row is what Hub UI
renders, what the watcher polls, and what admin reviews. One row, one
truth. The `ingest_route` column distinguishes v2 work from the legacy
Open WebUI path so both can coexist during cutover.

**Where v2 runs** — On CHARLIE only, today. MiraDrop is a CHARLIE-local UX
(`~/MiraDrop/inbox/`), so the heavy convert step stays local — no WAN
upload of large files, no contention with the 8 GB VPS. A cloud-side v2
instance for customer channels (Slack, email, web upload) ships later,
when there's an actual customer channel that needs it.

**Docling RAM levers (CHARLIE config)** — Two non-negotiable behaviors keep
docling bounded: (1) skip OCR when the source PDF has a text layer
(pypdf detects in ~50 ms; OEM manuals always have one); (2) spawn-per-job
process lifecycle — docling runs as a subprocess that's killed after
each PDF so PyTorch's allocator pool can't drift. Expected per-job peak
~1.5–2 GiB, idle 0 GiB.

**KG (Knowledge Graph)** — The structured store of entities and relationships
in Neon (`kg_entities`, `kg_relationships`). Answers the question "what does
MIRA know about X as a thing, with evidence?". Relationships have status
`proposed | verified | rejected | needs_review`.

**UNS templated item** — A reusable component profile attached to a canonical
UNS path under `enterprise.knowledge_base.{manufacturer}.{model}` (per
`mira-crawler/ingest/uns.py`). The template promotes a logical document's
extracted facts into a per-model, future-readable asset that any technician
or downstream tool can find by UNS path, not by filename.

## Readiness (future readers' contract)

A logical document moves through these readiness states. A future reader of
the KB or KG must be able to tell which state a chunk/entity is in.

1. **Parsed** — text extracted, chunked, embedded, retrievable in KB. No KG
   claims yet.
2. **Proposed** — KG has draft relationships sourced from this document
   (manufacturer, model, fault codes, components, parts). Status = `proposed`.
3. **Verified** — admin or technician has confirmed at least the core triple
   (manufacturer + model + at least one component or fault). Promotion is
   manual (per `.claude/CLAUDE.md` "Knowledge graph proposals").
4. **Templated** — once a model has enough verified evidence, a UNS component
   template is materialised at `enterprise.knowledge_base.{mfr}.{model}` and
   referenced by `equipment_entity_id` FK from future asset rows.
