"""FactoryLM governance primitives — shared, owner-neutral vocabularies.

Consumed by BOTH the PR-1 training-eligibility gate and the synthetic-flywheel
critic (and any future producer). Governance must NOT depend on ``synth`` or any
producer package — the dependency points inward (producers import governance).
"""
