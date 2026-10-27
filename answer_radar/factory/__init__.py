"""Benchmark Factory (docs/evals/benchmark-factory/IMPLEMENTATION_AND_VISION.md).

Extends Answer Radar rather than forking it: `BenchmarkCase` wraps
`answer_radar.schema.QuestionRecord`, the freeze reuses `answer_radar.freeze`, and the
source registry (`sources.yaml`) is the single place source policy lives. No module here
calls MIRA's own retrieval path: gold truth must not depend on the system under test.
"""
