"""MIRA Answer Quality Benchmark — live Groq + canned KB chunks + LLM judge.

Hits the real Groq cascade with a diagnostic prompt seeded by the same KB chunks
the conversation suite uses. Grades each reply on the 5-dim 1-5 Likert rubric
via tests/eval/judge.py (judge runs on Gemini or Groq depending on availability).

Run:
    doppler run -p factorylm -c prd -- \
        python tools/answer_quality_benchmark.py \
        --filter tag:demo_may21 --out docs/benchmarks/

Output: docs/benchmarks/YYYY-MM-DD_demo_may21_baseline.md

Spec: docs/specs/mira-answer-quality-standard.md
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import logging
import os
import sys
from pathlib import Path

import httpx
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from tests.eval.judge import Judge  # noqa: E402

logger = logging.getLogger("mira-answer-quality-benchmark")

FIXTURES_DIR = REPO_ROOT / "tests/conversation_suite/fixtures/cases"
KB_CHUNKS_DIR = REPO_ROOT / "tests/conversation_suite/fixtures/kb_chunks"

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")

DIAGNOSTIC_PROMPT = """\
You are MIRA, an industrial maintenance copilot grounded in the customer's
plant context. A maintenance technician on the factory floor is asking a
question. You have retrieved knowledge base chunks below.

Rules:
1. Use ONLY the KB chunks below to answer technical claims.
2. Every technical claim (register address, parameter value, wiring pin,
   fault code) MUST end with an inline citation tag of the form:
   [Source: <doc-name> §<section>]
3. **Ambiguity handling — strict trigger:** Ask one clarifying question
   ONLY when ALL three are true:
     (a) the question uses a generic article + class noun and no specific
         identifier ("the motor", "the sensor", "a drive"), AND
     (b) the KB chunks contain MULTIPLE candidate matches, AND
     (c) the question is open-ended ("keeps shutting off", "isn't
         working") rather than a direct lookup ("where is X wired").
   If the question names a specific identifier (e.g. "GS10", "GS11",
   "PE-001", "PowerFlex 525", "F004"), answer it directly from KB —
   never ask which one.
4. **KB-empty handling:** if the KB has nothing relevant AND the question
   is specific enough to act on, give a brief structured checklist of
   first-checks from general industrial practice, prefaced with "I don't
   have KB coverage for that — generic checks:". Don't just say "check
   the manual."
5. Be concise — short paragraphs, bullet steps, no AI-assistant fluff.
   Read on a phone in a noisy plant.
6. Tell the technician what to DO, not just what things ARE.
7. Never approve a PLC write, motor start, or safety bypass. For high-energy
   work, escalate to LOTO / de-energize.

Knowledge base chunks (may be empty):
{rag_context}

Technician question:
{user_question}

Reply directly. No preamble.
"""


def load_kb_chunks(fixture: dict) -> str:
    """Load KB chunks JSON referenced by fixture and format as RAG context."""
    chunk_ref = fixture.get("mock_kb_chunks")
    if not chunk_ref:
        return ""
    chunk_path = KB_CHUNKS_DIR / f"{chunk_ref}.json"
    if not chunk_path.exists():
        logger.warning("KB chunks missing for %s: %s", fixture["id"], chunk_path)
        return ""
    try:
        chunks = json.loads(chunk_path.read_text())
    except json.JSONDecodeError as exc:
        logger.warning("Bad JSON in %s: %s", chunk_path, exc)
        return ""
    parts = []
    for i, c in enumerate(chunks, 1):
        src = c.get("source", "unknown")
        sec = c.get("section", "")
        text = c.get("text", "").strip()
        head = f"[Chunk {i}] {src}" + (f" §{sec}" if sec else "")
        parts.append(f"{head}\n{text}")
    return "\n\n".join(parts)


async def call_groq(question: str, rag_context: str) -> tuple[str, str]:
    """Call Groq with the diagnostic prompt. Returns (reply, model)."""
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        return "", "missing-key"
    prompt = DIAGNOSTIC_PROMPT.format(
        rag_context=rag_context or "(no KB chunks retrieved)",
        user_question=question,
    )
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are MIRA, the industrial maintenance copilot."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 800,
        "temperature": 0.2,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                GROQ_URL,
                json=body,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("Groq call failed: %s", exc)
            return "", GROQ_MODEL
        data = resp.json()
    return data["choices"][0]["message"]["content"], GROQ_MODEL


def discover_fixtures(filter_spec: str) -> list[Path]:
    """tag:NAME — collect all fixture YAMLs with tag in `tags` list."""
    key, _, value = filter_spec.partition(":")
    out: list[Path] = []
    for path in sorted(FIXTURES_DIR.rglob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text())
        except yaml.YAMLError:
            continue
        if key == "tag" and value in (data.get("tags") or []):
            out.append(path)
        elif key == "category" and data.get("category") == value:
            out.append(path)
        elif key == "id" and value in data.get("id", ""):
            out.append(path)
    return out


async def benchmark_one(fixture_path: Path, judge: Judge) -> dict:
    fixture = yaml.safe_load(fixture_path.read_text())
    fid = fixture["id"]
    question = fixture["turns"][0]["content"]
    rag = load_kb_chunks(fixture)

    logger.info("→ %s", fid)
    reply, model = await call_groq(question, rag)

    if not reply:
        return {
            "fixture_id": fid,
            "question": question,
            "reply": "(EMPTY — model call failed)",
            "rag_chunks_present": bool(rag),
            "scores": {},
            "notes": {},
            "judge_error": "model call failed",
            "generated_by": "groq",
            "model": model,
        }

    grade = judge.grade(
        response=reply,
        rag_context=rag,
        user_question=question,
        generated_by="groq",
        scenario_id=fid,
    )

    return {
        "fixture_id": fid,
        "question": question,
        "reply": reply,
        "rag_chunks_present": bool(rag),
        "scores": grade.scores,
        "notes": grade.notes,
        "judge_error": grade.error,
        "judge_model": grade.judge_model,
        "judge_provider": grade.judge_provider,
        "generated_by": "groq",
        "model": model,
    }


def render_markdown(results: list[dict], filter_spec: str) -> str:
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H%MZ")
    dims = ("groundedness", "helpfulness", "tone", "instruction_following", "conversational_flow")

    def avg(values):
        return sum(values) / len(values) if values else 0.0

    per_fixture_avgs = [avg(list(r["scores"].values())) for r in results if r["scores"]]
    suite_avg = avg(per_fixture_avgs)

    lines = [
        f"# MIRA Answer Quality Benchmark — {today}",
        "",
        f"**Suite:** `{filter_spec}` ({len(results)} fixtures)",
        "**Generator:** Groq llama-3.3-70b-versatile",
        "**Spec:** `docs/specs/mira-answer-quality-standard.md`",
        "",
        "## Aggregate",
        "",
        f"- **Suite-wide average (5 dims × {len(per_fixture_avgs)} fixtures):** **{suite_avg:.2f} / 5**",
        "- **Pass threshold (per spec §4):** 3.50",
        f"- **Result:** {'PASS' if suite_avg >= 3.5 else 'FAIL'}",
        "",
        "## Per-dimension averages",
        "",
        "| Dimension | Avg |",
        "|---|---|",
    ]
    for dim in dims:
        vals = [r["scores"].get(dim) for r in results if r["scores"].get(dim) is not None]
        lines.append(f"| {dim} | {avg(vals):.2f} |")
    lines.append("")

    lines += ["## Per-fixture", "", "| # | Fixture | Avg | Grounded | Help | Tone | Follow | Flow | Cite? |", "|---|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(results, 1):
        s = r["scores"]
        scores_avg = avg(list(s.values())) if s else 0.0
        cite = "yes" if "[Source:" in (r["reply"] or "") else "no"
        lines.append(
            f"| {i} | `{r['fixture_id']}` | {scores_avg:.1f} | "
            f"{s.get('groundedness', '-')} | {s.get('helpfulness', '-')} | "
            f"{s.get('tone', '-')} | {s.get('instruction_following', '-')} | "
            f"{s.get('conversational_flow', '-')} | {cite} |"
        )
    lines.append("")

    lines += ["## Replies and judge notes", ""]
    for i, r in enumerate(results, 1):
        lines.append(f"### {i}. `{r['fixture_id']}`")
        lines.append("")
        lines.append(f"**Question:** {r['question']}")
        lines.append("")
        lines.append(f"**KB chunks present:** {r['rag_chunks_present']}")
        lines.append("")
        lines.append("**Reply:**")
        lines.append("")
        lines.append("```")
        lines.append(r["reply"][:1500])
        lines.append("```")
        lines.append("")
        if r["judge_error"]:
            lines.append(f"**Judge error:** `{r['judge_error']}`")
        else:
            lines.append(
                f"**Scores** (judge: {r.get('judge_provider')}/{r.get('judge_model')}):"
            )
            for dim in dims:
                score = r["scores"].get(dim)
                note = r["notes"].get(dim, "")
                lines.append(f"- **{dim}:** {score} — {note}")
        lines.append("")

    return "\n".join(lines)


async def main() -> int:
    parser = argparse.ArgumentParser(prog="mira-answer-quality-benchmark")
    parser.add_argument("--filter", default="tag:demo_may21")
    parser.add_argument("--out", default="docs/benchmarks/")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    fixtures = discover_fixtures(args.filter)
    if not fixtures:
        print(f"No fixtures matched {args.filter!r}", file=sys.stderr)
        return 2
    print(f"Benchmarking {len(fixtures)} fixtures against Groq…")

    judge = Judge()
    results = []
    for fixture_path in fixtures:
        try:
            row = await benchmark_one(fixture_path, judge)
        except Exception as exc:
            logger.exception("benchmark_one crashed for %s", fixture_path.name)
            row = {
                "fixture_id": fixture_path.stem,
                "question": "(crashed)",
                "reply": f"(crashed: {exc!r})",
                "rag_chunks_present": False,
                "scores": {},
                "notes": {},
                "judge_error": f"crashed: {exc!r}",
                "generated_by": "groq",
                "model": GROQ_MODEL,
            }
        results.append(row)
        scores = row.get("scores", {})
        if scores:
            avg = sum(scores.values()) / len(scores)
            print(f"  {row['fixture_id']}: avg={avg:.1f}")
        else:
            print(f"  {row['fixture_id']}: NO SCORES — {row.get('judge_error')}")

    md = render_markdown(results, args.filter)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    suite = args.filter.replace(":", "_").replace("/", "_")
    out_path = out_dir / f"{today}_{suite}_baseline.md"
    out_path.write_text(md)
    print(f"\nReport: {out_path}")

    # JSONL sidecar for downstream automation
    jsonl_path = out_dir / f"{today}_{suite}_baseline.jsonl"
    with jsonl_path.open("w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    print(f"JSONL:  {jsonl_path}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
