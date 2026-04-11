#!/usr/bin/env python3
"""MIRA MCQ Benchmark Evaluator.

Fires 100 multiple-choice industrial maintenance questions at Open WebUI's
OpenAI-compatible API, parses the model's answer letter, and scores against
the answer key. Outputs JSON results, CSV summary, and human-readable report.

Usage:
    python tests/mira_eval.py                           # All 100 questions
    python tests/mira_eval.py --limit 10                # First 10 only
    python tests/mira_eval.py --model gsd:latest        # Override model
    python tests/mira_eval.py --url http://bravo:3000   # Remote target
    python tests/mira_eval.py --domain VFD              # Filter by domain
    python tests/mira_eval.py --difficulty hard          # Filter by difficulty

Env vars (via Doppler):
    OPENWEBUI_API_KEY   — bearer token (required)
    OPENWEBUI_URL       — base URL (default: http://localhost:3000)
    MIRA_EVAL_MODEL     — model name (default: qwen2.5:7b-instruct-q4_K_M)
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mira-eval")

BENCHMARK_PATH = Path(__file__).parent / "benchmark" / "mira_mcq_benchmark.json"
RESULTS_DIR = Path(__file__).parent / "results"

SYSTEM_PROMPT = (
    "You are an industrial maintenance expert taking a multiple-choice exam. "
    "Read the question carefully and respond with ONLY the letter of the correct "
    "answer (A, B, C, or D). Do not explain your reasoning. Just the letter."
)

SYSTEM_PROMPT_COT = (
    "You are an industrial maintenance expert taking a multiple-choice exam. "
    "This is a calculation question. Think step by step: show the formula, "
    "substitute the values, compute the result, then state your final answer "
    "as ANSWER: followed by the letter (A, B, C, or D)."
)

CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6"

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile"

CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions"
DEFAULT_CEREBRAS_MODEL = "llama3.1-8b"

RAG_CONTEXT_HEADER = "\n\n--- REFERENCE DOCUMENTS ---\n"
RAG_CONTEXT_FOOTER = "--- END REFERENCES ---\n"

DEFAULT_MODEL = "qwen2.5:7b-instruct-q4_K_M"
DEFAULT_URL = "http://localhost:3000"
REQUEST_TIMEOUT = 30
DELAY_BETWEEN = 2  # seconds between requests


def load_questions(
    path: Path,
    domain: str | None = None,
    difficulty: str | None = None,
    limit: int = 0,
) -> list[dict]:
    """Load and optionally filter benchmark questions."""
    with open(path) as f:
        questions = json.load(f)

    if domain:
        domain_lower = domain.lower()
        questions = [q for q in questions if domain_lower in q["domain"].lower()]

    if difficulty:
        questions = [q for q in questions if q["difficulty"] == difficulty]

    if limit > 0:
        questions = questions[:limit]

    return questions


def format_question(q: dict) -> str:
    """Format a question with stem and options for the user message."""
    lines = [q["stem"], ""]
    for letter in ("A", "B", "C", "D"):
        lines.append(f"{letter}) {q['options'][letter]}")
    return "\n".join(lines)


def parse_answer(response: str) -> str:
    """Extract the answer letter (A/B/C/D) from model response."""
    if not response:
        return "INVALID"

    text = response.strip()

    # Direct single-letter match
    if text.upper() in ("A", "B", "C", "D"):
        return text.upper()

    # Chain-of-thought: "ANSWER: X" at end of reasoning
    answer_match = re.search(r"ANSWER:\s*([A-D])\b", text.upper())
    if answer_match:
        return answer_match.group(1)

    # "The answer is X" pattern
    the_answer = re.search(r"(?:the\s+)?answer\s+is\s+([A-D])\b", text, re.IGNORECASE)
    if the_answer:
        return the_answer.group(1).upper()

    # Last letter mentioned (for CoT responses that end with just the letter)
    all_letters = re.findall(r"\b([A-D])\b", text.upper())
    if all_letters:
        return all_letters[-1]

    return "INVALID"


def retrieve_rag_context(
    question_text: str,
    ollama_url: str,
    embed_model: str = "nomic-embed-text:latest",
) -> str:
    """Embed question via Ollama, query NeonDB, return formatted context string."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / "mira-bots"))
    from shared import neon_recall

    # Embed the question
    try:
        resp = httpx.post(
            f"{ollama_url}/api/embeddings",
            json={"model": embed_model, "prompt": question_text},
            timeout=30,
        )
        resp.raise_for_status()
        embedding = resp.json()["embedding"]
    except Exception as e:
        logger.warning("Ollama embed failed: %s", e)
        return ""

    tenant_id = os.environ.get("MIRA_TENANT_ID", "")
    if not tenant_id:
        logger.warning("MIRA_TENANT_ID not set — RAG retrieval skipped")
        return ""

    chunks = neon_recall.recall_knowledge(
        embedding, tenant_id, limit=3, query_text=question_text,
    )
    if not chunks:
        return ""

    # Quality gate: only inject when top chunk is genuinely relevant
    top_score = max((c.get("similarity", 0) for c in chunks), default=0)
    if top_score < 0.70:
        return ""

    lines = [RAG_CONTEXT_HEADER]
    for i, chunk in enumerate(chunks[:3], 1):
        mfr = chunk.get("manufacturer") or ""
        model_num = chunk.get("model_number") or ""
        label = f"{mfr} {model_num}".strip() or chunk.get("equipment_type") or "reference"
        lines.append(f"[{i}] [{label}] {chunk['content']}\n")
    lines.append(RAG_CONTEXT_FOOTER)
    return "\n".join(lines)


def _call_claude(
    client: httpx.Client,
    api_key: str,
    model: str,
    system_content: str,
    user_content: str,
    max_tokens: int = 300,
) -> str:
    """Call Claude API directly via httpx. Returns response text."""
    resp = client.post(
        CLAUDE_API_URL,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "system": system_content,
            "messages": [{"role": "user", "content": user_content}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]


def _call_openai_compat(
    client: httpx.Client,
    api_url: str,
    api_key: str,
    model: str,
    system_content: str,
    user_content: str,
    max_tokens: int = 300,
) -> str:
    """Call an OpenAI-compatible API (Groq, Cerebras). Returns response text."""
    resp = client.post(
        api_url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_content},
            ],
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_openwebui(
    client: httpx.Client,
    url: str,
    api_key: str,
    model: str,
    system_content: str,
    user_content: str,
) -> str:
    """Call Open WebUI chat completions API. Returns response text."""
    resp = client.post(
        f"{url}/api/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_content},
            ],
            "stream": False,
        },
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def evaluate_question(
    q: dict,
    client: httpx.Client,
    url: str,
    model: str,
    api_key: str,
    rag_context: str = "",
    provider: str = "openwebui",
    provider_url: str = "",
) -> dict:
    """Send one question to the API and score the response."""
    result = {
        "id": q["id"],
        "domain": q["domain"],
        "difficulty": q["difficulty"],
        "type": q["type"],
        "stem": q["stem"],
        "correct_answer": q["key"],
        "model_answer": "ERROR",
        "is_correct": False,
        "response_raw": "",
        "response_time_ms": 0,
        "rag_chunks": len(rag_context) > 0,
        "error": None,
    }

    is_calc = q.get("type") == "calculation"
    system_content = SYSTEM_PROMPT_COT if is_calc else SYSTEM_PROMPT
    if rag_context:
        system_content += rag_context

    user_content = format_question(q)

    t0 = time.monotonic()
    try:
        if provider == "claude":
            tokens = 800 if is_calc else 300
            response_text = _call_claude(
                client, api_key, model, system_content, user_content, max_tokens=tokens,
            )
        elif provider in ("groq", "cerebras"):
            tokens = 800 if is_calc else 300
            response_text = _call_openai_compat(
                client, provider_url, api_key, model, system_content, user_content,
                max_tokens=tokens,
            )
        else:
            response_text = _call_openwebui(client, url, api_key, model, system_content, user_content)
        result["response_raw"] = response_text
        result["model_answer"] = parse_answer(response_text)
        result["is_correct"] = result["model_answer"] == q["key"]
    except httpx.TimeoutException:
        result["error"] = "TIMEOUT"
        logger.warning("Q%d: timeout after %ds", q["id"], REQUEST_TIMEOUT)
    except httpx.HTTPStatusError as e:
        result["error"] = f"HTTP {e.response.status_code}"
        logger.warning("Q%d: HTTP %d — %s", q["id"], e.response.status_code, e.response.text[:100])
    except Exception as e:
        result["error"] = str(e)[:200]
        logger.warning("Q%d: %s", q["id"], e)

    result["response_time_ms"] = int((time.monotonic() - t0) * 1000)
    return result


def write_results(results: list[dict], model: str, timestamp: str) -> None:
    """Write the three output files."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Full JSON
    json_path = RESULTS_DIR / "mcq_eval_results.json"
    output = {
        "model": model,
        "timestamp": timestamp,
        "total": len(results),
        "correct": sum(1 for r in results if r["is_correct"]),
        "results": results,
    }
    with open(json_path, "w") as f:
        json.dump(output, f, indent=2)
    logger.info("Written: %s", json_path)

    # 2. CSV summary
    csv_path = RESULTS_DIR / "mcq_eval_summary.csv"
    fieldnames = [
        "id", "domain", "difficulty", "type", "correct_answer",
        "model_answer", "is_correct", "response_time_ms", "error",
    ]
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow({k: r[k] for k in fieldnames})
    logger.info("Written: %s", csv_path)

    # 3. Human-readable report
    report_path = RESULTS_DIR / "mcq_eval_report.txt"
    report = build_report(results, model, timestamp)
    with open(report_path, "w") as f:
        f.write(report)
    logger.info("Written: %s", report_path)


def build_report(results: list[dict], model: str, timestamp: str) -> str:
    """Build the human-readable summary report."""
    total = len(results)
    correct = sum(1 for r in results if r["is_correct"])
    accuracy = (correct / total * 100) if total else 0
    errors = sum(1 for r in results if r["error"])

    lines = [
        "=" * 50,
        "MIRA MCQ Benchmark Results",
        "=" * 50,
        f"Model:    {model}",
        f"Date:     {timestamp}",
        f"Total:    {total}  |  Correct: {correct}  |  Accuracy: {accuracy:.1f}%",
        f"Errors:   {errors}",
        "",
    ]

    # By domain
    lines.append("--- By Domain ---")
    domains: dict[str, list[dict]] = {}
    for r in results:
        domains.setdefault(r["domain"], []).append(r)
    for domain in sorted(domains):
        items = domains[domain]
        c = sum(1 for r in items if r["is_correct"])
        t = len(items)
        pct = c / t * 100 if t else 0
        lines.append(f"  {domain:<45s} {c:>2}/{t:<2}  ({pct:5.1f}%)")
    lines.append("")

    # By difficulty
    lines.append("--- By Difficulty ---")
    for diff in ("easy", "medium", "hard"):
        items = [r for r in results if r["difficulty"] == diff]
        if not items:
            continue
        c = sum(1 for r in items if r["is_correct"])
        t = len(items)
        pct = c / t * 100 if t else 0
        lines.append(f"  {diff:<12s} {c:>2}/{t:<2}  ({pct:5.1f}%)")
    lines.append("")

    # By type
    lines.append("--- By Type ---")
    for qtype in ("scenario", "recall", "calculation"):
        items = [r for r in results if r["type"] == qtype]
        if not items:
            continue
        c = sum(1 for r in items if r["is_correct"])
        t = len(items)
        pct = c / t * 100 if t else 0
        lines.append(f"  {qtype:<12s} {c:>2}/{t:<2}  ({pct:5.1f}%)")
    lines.append("")

    # Missed questions
    missed = [r for r in results if not r["is_correct"] and not r["error"]]
    if missed:
        lines.append("--- Missed Questions ---")
        for r in missed:
            lines.append(
                f"  Q{r['id']:<3d} [{r['domain'][:20]}/{r['difficulty']}] "
                f"Expected: {r['correct_answer']}, Got: {r['model_answer']}"
            )
        lines.append("")

    # Error questions
    errored = [r for r in results if r["error"]]
    if errored:
        lines.append("--- Errors ---")
        for r in errored:
            lines.append(f"  Q{r['id']:<3d} {r['error']}")
        lines.append("")

    # Slowest responses
    lines.append("--- Slowest Responses ---")
    by_time = sorted(results, key=lambda r: r["response_time_ms"], reverse=True)
    for r in by_time[:5]:
        lines.append(f"  Q{r['id']:<3d} {r['response_time_ms']:,} ms")
    lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="MIRA MCQ Benchmark Evaluator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--limit", type=int, default=0, help="Max questions to run (0=all)")
    parser.add_argument("--model", type=str, default=None, help="Model name override")
    parser.add_argument("--url", type=str, default=None, help="Open WebUI base URL")
    parser.add_argument("--domain", type=str, default=None, help="Filter by domain substring")
    parser.add_argument("--difficulty", type=str, default=None, help="Filter: easy/medium/hard")
    parser.add_argument("--benchmark", type=str, default=None, help="Path to benchmark JSON")
    parser.add_argument("--rag", action="store_true", help="Enable NeonDB RAG retrieval per question")
    parser.add_argument("--claude", action="store_true", help="Use Claude API instead of Open WebUI")
    parser.add_argument("--groq", action="store_true", help="Use Groq API (Llama 3.3 70B)")
    parser.add_argument("--cerebras", action="store_true", help="Use Cerebras API (Llama 3.1 8B)")
    parser.add_argument("--ollama-url", type=str, default=None, help="Ollama URL for RAG embeddings")
    args = parser.parse_args()

    provider = "openwebui"
    provider_url = ""
    if args.groq:
        provider = "groq"
        provider_url = GROQ_API_URL
        api_key = os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            logger.error("GROQ_API_KEY not set.")
            sys.exit(1)
        model = args.model or os.environ.get("GROQ_MODEL", DEFAULT_GROQ_MODEL)
    elif args.cerebras:
        provider = "cerebras"
        provider_url = CEREBRAS_API_URL
        api_key = os.environ.get("CEREBRAS_API_KEY", "")
        if not api_key:
            logger.error("CEREBRAS_API_KEY not set.")
            sys.exit(1)
        model = args.model or os.environ.get("CEREBRAS_MODEL", DEFAULT_CEREBRAS_MODEL)
    elif args.claude:
        provider = "claude"
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            logger.error("ANTHROPIC_API_KEY not set.")
            sys.exit(1)
        model = args.model or os.environ.get("CLAUDE_MODEL", DEFAULT_CLAUDE_MODEL)
    else:
        api_key = os.environ.get("OPENWEBUI_API_KEY", "")
        if not api_key:
            logger.error("OPENWEBUI_API_KEY not set. Run with Doppler or set env var.")
            sys.exit(1)
        model = args.model or os.environ.get("MIRA_EVAL_MODEL", DEFAULT_MODEL)

    url = (args.url or os.environ.get("OPENWEBUI_URL", DEFAULT_URL)).rstrip("/")
    benchmark_path = Path(args.benchmark) if args.benchmark else BENCHMARK_PATH

    questions = load_questions(
        benchmark_path,
        domain=args.domain,
        difficulty=args.difficulty,
        limit=args.limit,
    )

    if not questions:
        logger.error("No questions loaded. Check filters and benchmark path.")
        sys.exit(1)

    ollama_url = (args.ollama_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
    rag_mode = args.rag
    mode_label = f"{provider}+RAG" if rag_mode else provider

    logger.info(
        "Loaded %d questions | Model: %s | Provider: %s | Mode: %s",
        len(questions), model, provider, mode_label,
    )

    results: list[dict] = []
    correct_count = 0

    with httpx.Client() as client:
        for i, q in enumerate(questions, 1):
            domain_short = q["domain"][:25]
            print(
                f"\rTesting {i}/{len(questions)}: Q{q['id']} {domain_short} "
                f"[{q['difficulty']}] ({mode_label})...    ",
                end="",
                flush=True,
            )

            rag_context = ""
            if rag_mode:
                rag_context = retrieve_rag_context(q["stem"], ollama_url)

            result = evaluate_question(
                q, client, url, model, api_key,
                rag_context=rag_context, provider=provider, provider_url=provider_url,
            )
            results.append(result)

            if result["is_correct"]:
                correct_count += 1

            # Delay between requests
            if i < len(questions):
                time.sleep(DELAY_BETWEEN)

    print()  # newline after progress

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_results(results, model, timestamp)

    # Print summary to stdout
    report = build_report(results, model, timestamp)
    print(report)


if __name__ == "__main__":
    main()
