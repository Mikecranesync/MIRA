"""factorylm_ai.flywheel — interactions -> reviewed records -> Together fine-tuning JSONL.

ZTA role: the flywheel is the loop that turns real technician interactions
into reusable training/eval artifacts, with a human-review and data-
governance gate at every step:

- :mod:`factorylm_ai.flywheel.records` — builders for the four flywheel
  record shapes (interaction_record, feedback_event, training_record,
  eval_case), each schema-validated on construction. Training records carry
  a hard provenance law: no ``source_interaction_ids``, no record.
- :mod:`factorylm_ai.flywheel.redact` — strips IPs/MACs/serial numbers from
  record text before it is ever written to a shared corpus.
- :mod:`factorylm_ai.flywheel.splits` — deterministic 70/10/10/10 split
  assignment plus the near-duplicate guard that keeps train and holdout from
  leaking into each other.
- :mod:`factorylm_ai.flywheel.export` — the terminal write step: approved,
  redacted, split-assigned records out to Together fine-tuning JSONL.
  Refuses to write an unapproved record; never writes the holdout split.

Nothing here runs automatically against production interaction data — see
``docs/zta/factorylm-ai-model-lab.md``. Every export is a deliberate, human-
reviewed act (``approved_by`` is mandatory), consistent with the rest of the
model lab's fail-closed promotion doctrine (:mod:`factorylm_ai.registry`).
"""

from __future__ import annotations
