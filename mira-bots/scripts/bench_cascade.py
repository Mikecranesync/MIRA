#!/usr/bin/env python3
"""Side-by-side bench of cascade providers + candidate local models.

Sends a fixed set of PLC-fault prompts to each enabled provider using the
SAME system prompt loaded from prompts/diagnose/active.yaml. Writes a
markdown report with one section per prompt, one subsection per provider,
for manual quality review.

This is a human-eval harness — no judge, no DB writes, no state. Run it
before promoting a new model (e.g. Nemotron-Nano-9B on Bravo Ollama) into
the cascade in shared/inference/router.py.

Usage:
    python scripts/bench_cascade.py
    python scripts/bench_cascade.py --output bench.md
    python scripts/bench_cascade.py --skip-local

Env (cloud providers — same names as router.py):
    GROQ_API_KEY, GROQ_MODEL
    CEREBRAS_API_KEY, CEREBRAS_MODEL
    TOGETHERAI_API_KEY, TOGETHERAI_MODEL

Env (local Bravo Ollama — only needed for candidate model comparison):
    BRAVO_OLLAMA_URL    e.g. http://bravo:11434/v1
    NEMOTRON_MODEL      Ollama tag, default "nemotron-nano:9b"
    MIRA_LOCAL_MODEL    Ollama tag for existing local fallback, default "mira:latest"
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import httpx

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "mira-bots"))

from shared.inference.router import get_system_prompt  # noqa: E402

BENCH_PROMPTS = [
    "vfd faulted out, whole line stopped",
    "GS20, shows OC, trips the instant I hit run",
    "E.OC on the GS20, motor ran fine yesterday, nothing changed",
    "I'm in the MCC replacing a contactor, main breaker is still on — should be quick",
    "SEW Eurodrive MDX61B showing F07 fault, motor stalls under load",
    "ABB ACS580 trips fault 2310 at about 60% load on a 30kW pump, factory default current limit",
    "Allen-Bradley PowerFlex 525 won't start, display shows F091 every time I hit start",
    "Mitsubishi FR-E700 inverter is overheating, fan runs but it still trips OH1 after 10 minutes",
    "GS10 5HP centrifugal pump, factory defaults, trips overcurrent on every start, no reactor",
    "Yaskawa GA700 oC trip, motor is older, last megger reading was 0.9 megohm",
]


@dataclass
class Endpoint:
    name: str
    url: str
    model: str
    api_key: str
    timeout: float = 30.0


def build_endpoints(skip_local: bool) -> list[Endpoint]:
    eps: list[Endpoint] = []

    if os.getenv("GROQ_API_KEY"):
        eps.append(Endpoint(
            name="groq",
            url="https://api.groq.com/openai/v1/chat/completions",
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            api_key=os.getenv("GROQ_API_KEY", ""),
        ))
    if os.getenv("CEREBRAS_API_KEY"):
        eps.append(Endpoint(
            name="cerebras",
            url="https://api.cerebras.ai/v1/chat/completions",
            model=os.getenv("CEREBRAS_MODEL", "gpt-oss-120b"),
            api_key=os.getenv("CEREBRAS_API_KEY", ""),
        ))
    if os.getenv("TOGETHERAI_API_KEY"):
        eps.append(Endpoint(
            name="together",
            url="https://api.together.xyz/v1/chat/completions",
            model=os.getenv("TOGETHERAI_MODEL", "meta-llama/Llama-3.3-70B-Instruct-Turbo"),
            api_key=os.getenv("TOGETHERAI_API_KEY", ""),
        ))

    if not skip_local:
        bravo_url = os.getenv("BRAVO_OLLAMA_URL", "").rstrip("/")
        if bravo_url:
            # Ollama cold-start can be slow; first call for each model loads it.
            eps.append(Endpoint(
                name="nemotron",
                url=f"{bravo_url}/chat/completions",
                model=os.getenv("NEMOTRON_MODEL", "nemotron-nano:9b"),
                api_key="ollama",
                timeout=120.0,
            ))
            eps.append(Endpoint(
                name="mira-local",
                url=f"{bravo_url}/chat/completions",
                model=os.getenv("MIRA_LOCAL_MODEL", "mira:latest"),
                api_key="ollama",
                timeout=120.0,
            ))

    return eps


async def call_endpoint(ep: Endpoint, system_prompt: str, user_msg: str) -> tuple[str, int]:
    payload = {
        "model": ep.model,
        "max_tokens": 512,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
    }
    headers = {
        "Authorization": f"Bearer {ep.api_key}",
        "Content-Type": "application/json",
    }
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=ep.timeout) as client:
            resp = await client.post(ep.url, headers=headers, json=payload)
            elapsed = int((time.monotonic() - t0) * 1000)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"], elapsed
    except httpx.HTTPStatusError as e:
        elapsed = int((time.monotonic() - t0) * 1000)
        return f"[HTTP {e.response.status_code}] {e.response.text[:300]}", elapsed
    except httpx.TimeoutException:
        return f"[TIMEOUT after {ep.timeout:.0f}s]", int(ep.timeout * 1000)
    except Exception as e:
        elapsed = int((time.monotonic() - t0) * 1000)
        return f"[ERROR] {type(e).__name__}: {e}", elapsed


async def bench(
    endpoints: list[Endpoint], prompts: list[str], system_prompt: str
) -> list[dict]:
    results: list[dict] = []
    for i, prompt in enumerate(prompts, 1):
        print(f"[{i}/{len(prompts)}] {prompt[:70]}", flush=True)
        responses: dict[str, dict] = {}
        for ep in endpoints:
            content, latency_ms = await call_endpoint(ep, system_prompt, prompt)
            responses[ep.name] = {
                "model": ep.model,
                "latency_ms": latency_ms,
                "content": content,
            }
            print(f"    {ep.name:<12} ({ep.model}) {latency_ms}ms / {len(content)} chars")
        results.append({"prompt": prompt, "responses": responses})
    return results


def render_markdown(
    results: list[dict], endpoints: list[Endpoint], system_prompt_len: int
) -> str:
    lines: list[str] = []
    lines.append(f"# Cascade Bench — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("")
    lines.append("Manual quality review. Pick the best response per prompt and note why.")
    lines.append("")
    providers_str = ", ".join(f"`{ep.name}` ({ep.model})" for ep in endpoints)
    lines.append(f"**Providers:** {providers_str}")
    lines.append(f"**System prompt:** {system_prompt_len} chars (from `prompts/diagnose/active.yaml`)")
    lines.append(f"**Prompts:** {len(results)}")
    lines.append("")
    lines.append("---")
    lines.append("")

    for i, row in enumerate(results, 1):
        lines.append(f"## Prompt {i}")
        lines.append("")
        lines.append(f"> {row['prompt']}")
        lines.append("")
        for ep in endpoints:
            r = row["responses"].get(ep.name)
            if not r:
                continue
            lines.append(f"### `{ep.name}` — {r['model']} — {r['latency_ms']}ms")
            lines.append("")
            lines.append("```")
            lines.append(r["content"])
            lines.append("```")
            lines.append("")
        lines.append(
            "**Verdict:** ___ (winner) — notes: ________________________________________"
        )
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


async def main_async() -> int:
    parser = argparse.ArgumentParser(description="Bench cascade providers side-by-side")
    parser.add_argument(
        "--output",
        default=f"bench_cascade_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md",
        help="Markdown output path",
    )
    parser.add_argument(
        "--skip-local",
        action="store_true",
        help="Skip Bravo Ollama endpoints (nemotron, mira-local)",
    )
    parser.add_argument(
        "--prompts-file",
        default="",
        help="Optional text file with one prompt per line (overrides built-ins)",
    )
    args = parser.parse_args()

    if args.prompts_file:
        with open(args.prompts_file, encoding="utf-8") as f:
            prompts = [
                line.strip()
                for line in f
                if line.strip() and not line.lstrip().startswith("#")
            ]
    else:
        prompts = BENCH_PROMPTS

    endpoints = build_endpoints(skip_local=args.skip_local)
    if not endpoints:
        print(
            "ERROR: no endpoints enabled. Set at least one of "
            "GROQ_API_KEY / CEREBRAS_API_KEY / GEMINI_API_KEY, or BRAVO_OLLAMA_URL."
        )
        return 1

    system_prompt = get_system_prompt()
    if not system_prompt:
        print("ERROR: get_system_prompt() returned empty — check prompts/diagnose/active.yaml")
        return 1

    print(f"Endpoints: {', '.join(ep.name for ep in endpoints)}")
    print(f"Prompts:   {len(prompts)}")
    print(f"System prompt: {len(system_prompt)} chars")
    print()

    results = await bench(endpoints, prompts, system_prompt)
    md = render_markdown(results, endpoints, len(system_prompt))

    out_path = Path(args.output)
    out_path.write_text(md, encoding="utf-8")
    print()
    print(f"Wrote {out_path} ({len(md)} chars)")
    return 0


def main() -> None:
    sys.exit(asyncio.run(main_async()))


if __name__ == "__main__":
    main()
