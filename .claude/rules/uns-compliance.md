# UNS Compliance

The UNS (Unified Namespace) is MIRA's canonical address space for every node
in the knowledge graph. Path builders live in `mira-crawler/ingest/uns.py`;
spec is `docs/specs/uns-kg-unification-spec.md`.

## Rules

1. **Never reinvent path builders.** Paths under `enterprise.*` are built
   ONLY by the functions in `mira-crawler/ingest/uns.py`
   (`manufacturer_path`, `model_path`, `fault_code_path`, `manual_path`,
   `pm_schedule_path`, `parts_list_path`, etc.). Don't hand-format
   `f"enterprise.knowledge_base.{mfr}.{model}"` anywhere.

2. **One extraction point per turn.** Vendor, model, fault code, category
   are resolved in `mira-bots/shared/uns_resolver.py` and live on
   `state["uns_context"]`. Never call `vendor_name_from_text()` or
   `_looks_like_model_number()` directly in engine, workers, or DST code —
   they are private to the resolver. If you need vendor info, read
   `state["uns_context"]["manufacturer"]`.

3. **Slugs are produced by `uns.slug()`.** Lowercase, runs of non-alphanumeric
   collapsed to `_`. Don't `.lower().replace(" ", "_")` ad-hoc.

4. **Fault codes are extracted BEFORE model candidates.** Fault patterns
   (`F0004`, `E001`, `oC`, `A002`) must be stripped from the model candidate
   token list before the model heuristic runs. Otherwise `"powerflex 525
   f0004"` mis-resolves to `model="f0004"` (the historical bug).

5. **Pure-digit models are valid when adjacent to a known vendor/family.**
   `"PowerFlex 525"` → `model="525"`. The old "must contain a letter" rule
   in `_looks_like_model_number` is wrong for this case and must not be
   reused.

6. **Reserved labels are off-limits.** `uns.RESERVED_LABELS` lists the
   structural type-marker labels (`site`, `area`, `equipment`,
   `fault_codes`, etc.). Don't use them as manufacturer / model / instance
   slugs.

7. **Lowercase only.** UNS paths are lowercase. Display names like
   `"Rockwell Automation"` live on `UNSContext.manufacturer`; the path
   segment is `uns.slug("Rockwell Automation")` → `rockwell_automation`.

8. **Offline mode is the floor.** The resolver must produce a useful result
   without NeonDB. DB enrichment is additive; any DB error falls back to
   the alias-table-only result.

9. **Confidence is a band, not a score.** Use the bands defined in
   `docs/specs/uns-message-resolver-spec.md §2.4`. Don't invent a new
   numeric scheme per call site.

## When this applies

- Any code under `mira-bots/`, `mira-crawler/`, `mira-mcp/`, `mira-pipeline/`,
  or `mira-bridge/` that touches manufacturer/model/fault-code extraction.
- Any new feature that builds a UNS path.
- Any test that asserts on a UNS path string.

## When this does NOT apply

- Pure UI text rendering (a label like "PowerFlex 525" in a chat reply is
  fine, that's a display string, not a path).
- LLM-facing prompts (prompts may use display names; the path is for the
  resolver and the KB query).
