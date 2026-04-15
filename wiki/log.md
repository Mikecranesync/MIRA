# MIRA Ops Wiki — Log

> Append-only chronological record. Each entry: `## [YYYY-MM-DD] type | description`
> Types: `deploy`, `incident`, `config`, `session`, `ingest`, `lint`

## [2026-04-15] session | Training loop + OW activation + prompt v0.8 (CHARLIE)
- feat/training-loop-v1 branch: synthetic_pair_gen.py, active_learner.py tuning, judge 5th dimension, celery beat task
- 5 OW tool scripts written (get_equipment_history, create_work_order, lookup_part, search_knowledge, setup_owui_models)
- 11 GitHub issues created for OW activation roadmap (#302–#312), added to Kanban board
- Prompt v0.7 (honesty-signal): 5th few-shot for out-of-KB path — targets 10 failing fixtures (#311)
- Prompt v0.8 (diagnosis-advance): 6th few-shot for FSM undershots — targets 9 failing fixtures (#310)
- Baseline eval: 30/56 (54%). v0.8 eval running — expected ~40/56 (71%)
- Blocked: Anthropic API credits exhausted (judge disabled). PR #297 pending merge.

## [2026-04-08] ingest | Wiki created from Karpathy LLM Wiki pattern
- Migrated infrastructure references from ~/.claude/memory/ into wiki/nodes/
- Created SCHEMA.md, index.md, hot.md, log.md
- Created gotcha pages for SSH keychain, NeonDB SSL, competing pollers, intent guard
- Machine: Windows Dev
