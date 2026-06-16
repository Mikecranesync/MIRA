# MIRA Testing

## 7 Test Regimes

| Regime | Focus | Offline? | Command |
|--------|-------|---------|---------|
| 1 | Intent classification, safety keywords, FSM | Yes | `pytest tests/ -k regime1 -v` |
| 2 | RAG retrieval quality | No (needs Open WebUI) | `pytest tests/ -k regime2 -v` |
| 3 | Nameplate OCR | No (needs Ollama) | `pytest tests/ -k regime3 -v` |
| 4 | Golden diagnostic cases | Yes | `pytest tests/ -k regime4 -v` |
| 5 | Nemotron reranking | No (needs NVIDIA key) | `pytest tests/ -k regime5 -v` |
| 6 | MCP sidecar tools | No (needs mira-mcp) | `pytest tests/ -k regime6 -v` |
| 7 | Ignition HMI Co-Pilot | No (needs Ignition) | `pytest tests/ -k regime7 -v` |

## Quick Commands

```bash
# Full offline suite (safe to run anywhere)
pytest tests/ -v --ignore=tests/regime2 --ignore=tests/regime3

# Just golden cases (fastest)
pytest tests/ -k regime4 -v

# Everything (requires all services running)
pytest tests/ -v
```

## Baseline

- 76 offline tests passing (regimes 1 + 4)
- 39 golden diagnostic cases
- All tests must pass before merging to main

## Golden Case Format

Located in `tests/fixtures/golden/`. Each case has:
- Input message (user text)
- Expected FSM state transition
- Confidence expectation (HIGH / MEDIUM / LOW)

## pytest Configuration

From `pyproject.toml`:
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

Uses `pytest-asyncio` for async test support.

## Evaluation Tools

- RAGAS for RAG quality scoring
- DeepEval for LLM output evaluation
- Custom MCQ benchmark in `evals/`

## After Running Tests

Report:
1. Total passed / failed / skipped counts
2. New failures vs baseline (76 offline passing)
3. Failure details with test name and assertion error
4. Which agent should fix each failure
