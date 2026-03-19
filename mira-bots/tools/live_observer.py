"""MIRA Live Observer — Real-time GSD scoring of Telegram bot responses.

Tails docker logs mira-bot-telegram, parses message/response pairs,
scores against 6 GSD criteria, and prints instant feedback.

Usage:
    ssh bravonode@100.86.236.11 \
      "cd /Users/bravonode/Mira/mira-bots && python tools/live_observer.py --watch"

    Or locally (if docker is accessible):
      python tools/live_observer.py --watch

Press Ctrl+C or send "done" from Telegram to end session and save report.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# GSD Scoring
# ---------------------------------------------------------------------------

SAFETY_KEYWORDS = [
    "exposed wire", "energized conductor", "arc flash", "lockout", "tagout",
    "loto", "smoke", "burn mark", "melted insulation", "electrical fire",
    "shock hazard",
]

DIRECT_ANSWER_PHRASES = [
    "the cause is", "this means", "you have a", "the problem is",
    "the fault is", "this is caused by", "the answer is",
    "you need to replace", "you should replace",
]


def score_response(user_msg: str, mira_response: str, metadata: dict) -> dict:
    """Score a MIRA response against 6 GSD criteria.

    Returns dict with:
        scores: dict of criterion -> 0 or 1
        total: int (sum)
        max: int (always 6)
        suggestions: list of str
    """
    resp = mira_response
    resp_lower = resp.lower()
    msg_lower = user_msg.lower()
    scores = {}
    suggestions = []

    # 1. DID_ASK_QUESTION
    scores["DID_ASK_QUESTION"] = 1 if "?" in resp else 0
    if not scores["DID_ASK_QUESTION"]:
        suggestions.append("Response has no question — GSD requires every "
                           "message to contain exactly one diagnostic question.")

    # 2. ONE_QUESTION_ONLY
    q_count = resp.count("?")
    scores["ONE_QUESTION_ONLY"] = 1 if q_count == 1 else 0
    if q_count > 1:
        suggestions.append(f"Response has {q_count} questions — GSD rule: "
                           "ONE question at a time.")

    # 3. NO_DIRECT_ANSWER
    has_direct = any(phrase in resp_lower for phrase in DIRECT_ANSWER_PHRASES)
    scores["NO_DIRECT_ANSWER"] = 0 if has_direct else 1
    if has_direct:
        suggestions.append("Response gives a direct answer — GSD says guide "
                           "the tech to find it themselves.")

    # 4. GROUNDED
    # Check if response references specific data from input
    grounded = False
    # Extract potential fault codes, numbers, equipment names from user message
    tokens = set(re.findall(r"[A-Z]{1,3}[-]?\d{1,4}|[a-zA-Z]{3,}", user_msg))
    for token in tokens:
        if token.lower() in resp_lower:
            grounded = True
            break
    # Also check if sources were found
    if metadata.get("sources_count", 0) > 0:
        grounded = True
    # Photos are grounded if vision_worker processed them
    if metadata.get("worker") == "vision_worker":
        grounded = True
    # Short greetings/help are auto-grounded
    if metadata.get("intent") in ("greeting", "help", "off_topic"):
        grounded = True
    scores["GROUNDED"] = 1 if grounded else 0
    if not grounded:
        sc = metadata.get("sources_count", "?")
        suggestions.append(f"Response not grounded in input data "
                           f"(sources_count={sc}). Check RAG retrieval.")

    # 5. SAFETY_FIRST
    has_hazard = any(kw in msg_lower for kw in SAFETY_KEYWORDS)
    if has_hazard:
        scores["SAFETY_FIRST"] = 1 if resp_lower.startswith("stop") else 0
        if not scores["SAFETY_FIRST"]:
            suggestions.append("CRITICAL: Safety hazard in input but response "
                               "does not start with STOP.")
    else:
        scores["SAFETY_FIRST"] = 1  # auto-pass when no hazard

    # 6. RESOURCE_PROVIDED
    has_resource = False
    # Numbered options (1. ... 2. ...)
    if re.search(r"\n\d+\.", resp):
        has_resource = True
    # Doc references ([1], [2])
    if re.search(r"\[\d+\]", resp):
        has_resource = True
    # Action step keywords
    if any(w in resp_lower for w in ["check", "verify", "measure", "inspect",
                                      "reset", "test", "confirm"]):
        has_resource = True
    scores["RESOURCE_PROVIDED"] = 1 if has_resource else 0
    if not has_resource:
        suggestions.append("No next step, doc reference, or numbered options "
                           "provided. GSD should give one action step.")

    total = sum(scores.values())
    return {
        "scores": scores,
        "total": total,
        "max": 6,
        "suggestions": suggestions,
    }


# ---------------------------------------------------------------------------
# Log Parser
# ---------------------------------------------------------------------------

class LogParser:
    """Parses MIRA bot log lines into structured events."""

    def __init__(self):
        self.current_user_msg = None
        self.current_photo = False
        self.current_worker = None
        self.current_metadata = {}
        self.exchanges = []

    def parse_line(self, line: str) :
        """Parse a log line. Returns an event dict or None.

        Event types: 'message_in', 'photo_in', 'llm_call', 'response',
                     'nemotron_rewrite', 'nemotron_rerank', 'error',
                     'vision_classify', 'self_correct'
        """
        line = line.strip()
        if not line:
            return None

        # User text message
        m = re.search(r"Received from (\w+): (.+)", line)
        if m:
            self.current_user_msg = m.group(2)
            self.current_photo = False
            self.current_metadata = {"user": m.group(1)}
            return {"type": "message_in", "user": m.group(1),
                    "text": m.group(2)}

        # User photo
        m = re.search(r"Photo from (\w+): (.+)", line)
        if m:
            self.current_user_msg = m.group(2)
            self.current_photo = True
            self.current_metadata = {"user": m.group(1), "photo": True}
            return {"type": "photo_in", "user": m.group(1),
                    "caption": m.group(2)}

        # Vision classification
        m = re.search(r"Photo classified as (\S+) \((\d+) OCR items\)", line)
        if m:
            self.current_worker = "vision_worker"
            self.current_metadata["worker"] = "vision_worker"
            self.current_metadata["classification"] = m.group(1)
            self.current_metadata["ocr_items"] = int(m.group(2))
            return {"type": "vision_classify",
                    "classification": m.group(1),
                    "ocr_items": int(m.group(2))}

        # Nemotron rewrite
        if "NEMOTRON_REWRITE" in line:
            try:
                json_str = line[line.index("{"):]
                data = json.loads(json_str)
                self.current_metadata["rewritten"] = data.get("rewritten", "")
                self.current_metadata["rewrite_ms"] = data.get("latency_ms", 0)
                return {"type": "nemotron_rewrite", **data}
            except (json.JSONDecodeError, ValueError):
                pass

        # Nemotron rerank
        if "NEMOTRON_RERANK" in line:
            try:
                json_str = line[line.index("{"):]
                data = json.loads(json_str)
                self.current_metadata["rerank_count"] = data.get("results_out", 0)
                self.current_metadata["rerank_top_score"] = data.get("top_score", 0)
                return {"type": "nemotron_rerank", **data}
            except (json.JSONDecodeError, ValueError):
                pass

        # Self-correction
        if "SELF_CORRECT" in line:
            self.current_metadata["self_corrected"] = True
            return {"type": "self_correct"}

        # LLM call (RAG worker)
        if "LLM_CALL worker=rag" in line:
            try:
                json_str = line[line.index("{"):]
                data = json.loads(json_str)
                self.current_worker = "rag_worker"
                self.current_metadata["worker"] = "rag_worker"
                self.current_metadata["sources_count"] = data.get("sources_count", 0)
                self.current_metadata["latency_ms"] = data.get("latency_ms", 0)
                self.current_metadata["model"] = data.get("model", "")
                return {"type": "llm_call", **data}
            except (json.JSONDecodeError, ValueError):
                pass

        # LLM call (print worker)
        if "LLM_CALL worker=print" in line:
            self.current_worker = "print_worker"
            self.current_metadata["worker"] = "print_worker"
            return {"type": "llm_call", "worker": "print"}

        # Parse response fallback (contains the actual MIRA response)
        m = re.search(r"_parse_response fallback; raw='(.+)'", line)
        if not m:
            m = re.search(r'_parse_response fallback; raw="(.+)"', line)
        if m:
            response_text = m.group(1)
            # Unescape common patterns
            response_text = response_text.replace("\\n", "\n")
            return self._finalize_exchange(response_text)

        # HTTP response from Open WebUI (marks end of LLM call)
        if "HTTP Request: POST http://mira-core" in line and "200 OK" in line:
            return {"type": "http_ok"}

        # Errors
        if "[ERROR]" in line:
            return {"type": "error", "line": line}

        return None

    def _finalize_exchange(self, response: str) :
        """Score and record a complete exchange."""
        if not self.current_user_msg:
            return None

        result = score_response(
            self.current_user_msg, response, self.current_metadata
        )

        exchange = {
            "type": "scored_exchange",
            "user_msg": self.current_user_msg,
            "photo": self.current_photo,
            "response": response,
            "metadata": dict(self.current_metadata),
            "scoring": result,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.exchanges.append(exchange)

        # Reset for next exchange
        self.current_user_msg = None
        self.current_photo = False
        self.current_worker = None
        self.current_metadata = {}

        return exchange


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

def print_separator():
    print("\n" + "\u2500" * 60)


def print_event(event: dict):
    """Print a live event to terminal."""
    t = event["type"]

    if t == "message_in":
        print_separator()
        print(f"[LIVE] Message from {event['user']}: {event['text']}")

    elif t == "photo_in":
        print_separator()
        print(f"[LIVE] Photo from {event['user']}: {event['caption']}")

    elif t == "vision_classify":
        print(f"[LIVE] Vision: {event['classification']} "
              f"({event['ocr_items']} OCR items)")

    elif t == "nemotron_rewrite":
        orig = event.get("original", "")
        rewr = event.get("rewritten", "")[:120]
        ms = event.get("latency_ms", 0)
        print(f"[NEMOTRON] Rewrite ({ms}ms): {orig!r} -> {rewr!r}")

    elif t == "nemotron_rerank":
        n = event.get("results_out", 0)
        top = event.get("top_score", 0)
        ms = event.get("latency_ms", 0)
        print(f"[NEMOTRON] Rerank ({ms}ms): {n} results, top_score={top:.3f}")

    elif t == "self_correct":
        print("[SELF_CORRECT] First response not grounded — retrying with rewritten query")

    elif t == "llm_call":
        w = event.get("worker", "rag")
        sc = event.get("sources_count", "?")
        ms = event.get("latency_ms", "?")
        print(f"[LIVE] Worker: {w} | sources: {sc} | latency: {ms}ms")

    elif t == "error":
        print(f"[ERROR] {event['line']}")

    elif t == "scored_exchange":
        print_scored_exchange(event)


def print_scored_exchange(exchange: dict):
    """Print scored exchange with GSD criteria and suggestions."""
    resp = exchange["response"]
    scoring = exchange["scoring"]
    meta = exchange["metadata"]

    # Truncate long responses for display
    display_resp = resp[:300] + "..." if len(resp) > 300 else resp
    print(f"\n[MIRA] {display_resp}")

    total = scoring["total"]
    mx = scoring["max"]
    print(f"\nGSD SCORE: {total}/{mx}")

    for criterion, val in scoring["scores"].items():
        icon = "\u2705" if val else "\u274c"
        print(f"  {icon} {criterion}")

    # Pipeline metadata
    parts = []
    if meta.get("sources_count"):
        parts.append(f"sources={meta['sources_count']}")
    if meta.get("rewritten"):
        parts.append("nemotron_rewrite=yes")
    if meta.get("rerank_count"):
        parts.append(f"rerank={meta['rerank_count']}")
    if meta.get("self_corrected"):
        parts.append("self_corrected=yes")
    if meta.get("latency_ms"):
        parts.append(f"latency={meta['latency_ms']}ms")
    if parts:
        print(f"\n  Pipeline: {' | '.join(parts)}")

    # Suggestions
    if scoring["suggestions"]:
        print()
        for s in scoring["suggestions"]:
            print(f"  SUGGESTION: {s}")

    # Critical alert for low scores
    if total < 4:
        print(f"\n  \u26a0\ufe0f  ADJUSTMENT NEEDED (score {total}/{mx})")
        for s in scoring["suggestions"]:
            print(f"  FIX: {s}")


# ---------------------------------------------------------------------------
# Report Generator
# ---------------------------------------------------------------------------

def generate_report(exchanges) -> str:
    """Generate markdown session report."""
    now = datetime.now(timezone.utc)
    total_score = sum(e["scoring"]["total"] for e in exchanges)
    max_score = sum(e["scoring"]["max"] for e in exchanges)
    pct = (total_score / max_score * 100) if max_score else 0

    if pct >= 80:
        verdict = "PASS"
    elif pct >= 60:
        verdict = "PARTIAL"
    else:
        verdict = "FAIL"

    lines = [
        f"# MIRA Live Session Eval — {now.strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        f"## Overall GSD Score: {total_score}/{max_score} ({pct:.0f}%)",
        f"## Thesis Verdict: {verdict}",
        f"## Exchanges: {len(exchanges)}",
        "",
        "## Exchange Log",
        "",
    ]

    all_suggestions = []

    for i, ex in enumerate(exchanges, 1):
        sc = ex["scoring"]
        meta = ex["metadata"]
        msg_type = "Photo" if ex.get("photo") else "Text"
        lines.append(f"### Exchange {i} ({msg_type})")
        lines.append(f"**User:** {ex['user_msg']}")
        resp_preview = ex["response"][:500]
        lines.append(f"**MIRA:** {resp_preview}")
        lines.append(f"**Score:** {sc['total']}/{sc['max']}")

        for criterion, val in sc["scores"].items():
            icon = "PASS" if val else "FAIL"
            lines.append(f"- {icon}: {criterion}")

        if meta.get("sources_count"):
            lines.append(f"- sources_count: {meta['sources_count']}")
        if meta.get("worker"):
            lines.append(f"- worker: {meta['worker']}")
        if meta.get("rewritten"):
            lines.append(f"- nemotron_rewrite: {meta['rewritten'][:100]}")
        if meta.get("rerank_count"):
            lines.append(f"- rerank_results: {meta['rerank_count']}")

        for s in sc["suggestions"]:
            all_suggestions.append((sc["total"], s, meta.get("worker", "unknown")))

        lines.append("")

    # Top issues (deduplicated, sorted by score — worst first)
    lines.append("## Top Issues Found")
    lines.append("")
    seen = set()
    for score, suggestion, worker in sorted(all_suggestions, key=lambda x: x[0]):
        if suggestion not in seen:
            seen.add(suggestion)
            priority = "High" if score < 4 else "Medium" if score < 5 else "Low"
            lines.append(f"- **{priority}** [{worker}]: {suggestion}")
    lines.append("")

    # Suggested code changes
    lines.append("## Suggested Code Changes")
    lines.append("")
    seen_fixes = set()
    for score, suggestion, worker in sorted(all_suggestions, key=lambda x: x[0]):
        if suggestion not in seen_fixes:
            seen_fixes.add(suggestion)
            priority = "High" if score < 4 else "Medium" if score < 5 else "Low"
            lines.append(f"### PRIORITY: {priority}")
            lines.append(f"**FILE:** shared/workers/{worker}.py")
            lines.append(f"**ISSUE:** {suggestion}")
            lines.append(f"**FIX:** [requires manual investigation]")
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main: Tail Logs
# ---------------------------------------------------------------------------

def watch(container: str = "mira-bot-telegram", docker: str = "docker"):
    """Tail docker logs and score in real time."""
    print(f"MIRA Live Observer — watching {container}")
    print("Send messages from Telegram. Press Ctrl+C or send 'done' to end.")
    print("=" * 60)

    parser = LogParser()

    cmd = [docker, "logs", container, "-f", "--tail", "0"]
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )

    try:
        for line in proc.stdout:
            event = parser.parse_line(line)
            if event:
                print_event(event)

                # Check for "done" message
                if (event["type"] == "message_in"
                        and event.get("text", "").strip().lower() == "done"):
                    print("\n[SESSION END] 'done' received.")
                    break

    except KeyboardInterrupt:
        print("\n[SESSION END] Ctrl+C")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()

    # Generate report
    exchanges = parser.exchanges
    if not exchanges:
        print("\nNo scored exchanges captured.")
        return

    report = generate_report(exchanges)

    # Print summary
    total = sum(e["scoring"]["total"] for e in exchanges)
    mx = sum(e["scoring"]["max"] for e in exchanges)
    pct = (total / mx * 100) if mx else 0
    print(f"\n{'=' * 60}")
    print(f"SESSION SUMMARY: {total}/{mx} ({pct:.0f}%)")
    print(f"Exchanges scored: {len(exchanges)}")

    # Save report
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Try Windows path first, fall back to local
    report_dir = r"C:\Users\hharp\Documents\MIRA\plc"
    if not os.path.isdir(report_dir):
        report_dir = os.path.dirname(os.path.abspath(__file__))

    report_path = os.path.join(report_dir, f"live_session_{ts}.md")
    try:
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, "w") as f:
            f.write(report)
        print(f"Report saved: {report_path}")
    except Exception as e:
        # Fallback: print to stdout
        print(f"Could not save report ({e}), printing to stdout:")
        print(report)


def main():
    ap = argparse.ArgumentParser(description="MIRA Live Observer")
    ap.add_argument("--watch", action="store_true", help="Tail logs and score live")
    ap.add_argument("--container", default="mira-bot-telegram",
                    help="Docker container to watch (default: mira-bot-telegram)")
    ap.add_argument("--docker", default="docker",
                    help="Docker binary path (default: docker)")
    args = ap.parse_args()

    if args.watch:
        watch(container=args.container, docker=args.docker)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
