"""run_engine — run-centric fault detection (issue #2341).

Pure, dependency-light core (stdlib only — NO numpy) for:

  - segmentation : detect machine "runs" from a config-driven trigger tag
  - baseline     : per-tag per-phase min/max/avg/stddev over the last N normal
                   runs (stdlib ``statistics``)
  - diff         : observed-vs-baseline anomaly diffs + sigma-distance severity
  - store        : a RunStore Protocol + InMemoryRunStore (tests) +
                   NeonRunStore (SQLAlchemy NullPool, RLS-bound)
  - pipeline     : run_historization() orchestrates the above over a RunStore;
                   unit-testable WITHOUT DB/Redis/Celery

The thin Celery-beat wrapper lives in ``tasks/historize_runs.py`` and is a
no-op unless ``MIRA_RUN_DIFF_ENABLED == "1"``.
"""
