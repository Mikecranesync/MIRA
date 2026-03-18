"""
healer.py — Per-case inline self-healing. Max 3 attempts. Only fires on FAIL.
"""
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Awaitable

_STOPWORDS = {
    "about", "above", "after", "again", "against", "before", "being",
    "between", "during", "further", "having", "other", "should", "their",
    "there", "these", "those", "through", "under", "until", "where",
    "which", "while", "within", "would",
}

# Buckets that NEVER trigger Step 2 (prompt rebuild)
_STEP2_BLOCKED = {"HALLUCINATION", "OCR_FAILURE"}


@dataclass
class HealResult:
    final_result: dict
    heal_type: str | None  # "HEALED_JUDGE" | "HEALED_PROMPT" | "CEILING" | None
    attempts: int
    original_bucket: str | None


class Healer:
    def __init__(
        self,
        judge_v2,
        ingest_url: str,
        core_compose_path: str,
        core_repo_root: str,
    ):
        self._judge = judge_v2
        self._ingest_url = ingest_url
        self._compose = core_compose_path
        self._core_root = Path(core_repo_root)
        self._rebuild_used = False  # only one rebuild per case

    async def attempt_heal(
        self,
        case: dict,
        failed_result: dict,
        reply: str,
        re_run_fn: Callable,
    ) -> HealResult:
        original_bucket = failed_result.get("failure_bucket")
        attempts = 0

        # Step 1 — judge error
        step1 = self._step1_judge(case, failed_result, reply)
        if step1 is not None:
            attempts += 1
            if step1["passed"]:
                return HealResult(
                    final_result=step1,
                    heal_type="HEALED_JUDGE",
                    attempts=attempts,
                    original_bucket=original_bucket,
                )

        # Step 2 — prompt error
        if (
            original_bucket in ("NO_FAULT_CAUSE", "NO_NEXT_STEP")
            and original_bucket not in _STEP2_BLOCKED
            and not self._rebuild_used
            and not self._has_numbered_markers(reply)
        ):
            step2 = await self._step2_prompt(case, re_run_fn)
            attempts += 1
            self._rebuild_used = True
            if step2 is not None and step2["passed"]:
                return HealResult(
                    final_result=step2,
                    heal_type="HEALED_PROMPT",
                    attempts=attempts,
                    original_bucket=original_bucket,
                )
            # restore system prompt if step2 failed
            if step2 is None or not step2["passed"]:
                self._restore_describe_system(
                    self._backup_describe_system_text
                    if hasattr(self, "_backup_describe_system_text")
                    else None
                )

        # Step 3 — ceiling
        return self._step3_ceiling(failed_result, attempts, original_bucket)

    # ── Step helpers ────────────────────────────────────────────────────────

    def _step1_judge(self, case: dict, result: dict, reply: str) -> dict | None:
        word_count = result.get("word_count", len(reply.split()))
        if word_count <= 20:
            return None
        nouns = self._extract_nouns(reply)
        if not nouns:
            return None
        self._judge.inject_patterns(nouns, nouns)
        return self._judge.score(case, reply)

    async def _step2_prompt(self, case: dict, re_run_fn: Callable) -> dict | None:
        backup = self._patch_describe_system(
            "Always label your response with (1), (2), (3)."
        )
        self._backup_describe_system_text = backup
        ok = self._rebuild_ingest()
        if not ok:
            return None
        try:
            reply, elapsed = await _maybe_await(re_run_fn(case))
            return self._judge.score(case, reply, elapsed)
        except Exception:
            return None

    def _step3_ceiling(
        self, result: dict, attempts: int, original_bucket: str | None
    ) -> HealResult:
        result = dict(result)
        result["failure_bucket"] = "CEILING"
        return HealResult(
            final_result=result,
            heal_type="CEILING",
            attempts=attempts,
            original_bucket=original_bucket,
        )

    # ── Utilities ────────────────────────────────────────────────────────────

    def _extract_nouns(self, reply: str) -> list[str]:
        words = reply.split()
        return [
            w.lower()
            for w in words
            if len(w) > 5 and w.isalpha() and w.lower() not in _STOPWORDS
        ]

    def _patch_describe_system(self, extra_instruction: str) -> str:
        """Append extra_instruction to DESCRIBE_SYSTEM in mira-ingest/main.py.
        Returns the backup of the original line."""
        main_py = self._core_root / "mira-ingest" / "main.py"
        text = main_py.read_text()
        # Find DESCRIBE_SYSTEM closing quote and append before it
        import re
        match = re.search(r'(DESCRIBE_SYSTEM\s*=\s*""")(.*?)(""")', text, re.DOTALL)
        if not match:
            # try single-quoted or single-line
            match = re.search(r"(DESCRIBE_SYSTEM\s*=\s*['\"])(.*?)(['\"])", text, re.DOTALL)
        if not match:
            return ""
        backup_text = text
        new_content = match.group(1) + match.group(2).rstrip() + "\n" + extra_instruction + "\n" + match.group(3)
        new_text = text[: match.start()] + new_content + text[match.end() :]
        main_py.write_text(new_text)
        return backup_text

    def _restore_describe_system(self, backup_text: str | None) -> None:
        if not backup_text:
            return
        main_py = self._core_root / "mira-ingest" / "main.py"
        main_py.write_text(backup_text)

    def _rebuild_ingest(self) -> bool:
        result = subprocess.run(
            ["docker", "compose", "-f", self._compose, "up", "-d", "--build", "mira-ingest"],
            capture_output=True,
        )
        if result.returncode != 0:
            return False
        return self._wait_healthy("mira-ingest", timeout=90)

    def _wait_healthy(self, container: str, timeout: int = 90) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            result = subprocess.run(
                ["docker", "inspect", container, "--format", "{{.State.Health.Status}}"],
                capture_output=True,
                text=True,
            )
            if result.stdout.strip() == "healthy":
                return True
            time.sleep(5)
        return False

    def _has_numbered_markers(self, reply: str) -> bool:
        import re
        return bool(re.search(r"\(1\)|\(2\)|\(3\)", reply))


async def _maybe_await(val):
    """Await a value if it is a coroutine, otherwise return it."""
    import asyncio
    if asyncio.iscoroutine(val):
        return await val
    return val
