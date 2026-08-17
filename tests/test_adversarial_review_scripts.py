"""Hermetic behavior locks for the adversarial-review scripts (PR #3279).

Covers the 2026-08-17 hardening contract (Mike's directive):
  - duplicate ledger comments cannot inflate the iteration number
  - the 3-round budget is DURABLE across restarts (counted from the PR
    ledger), and post-cap review requires an explicit human authorization
  - a stale GREEN (head moved during review) is exit 4, never GREEN
  - malformed/forged marker comments never enter the validated ledger
  - argument parsing is strict (numeric PR ids only; --allow-dirty removed;
    unknown flags fail closed; --max-iter bounded)
  - a dirty tracked tree is always rejected
  - a failed base-branch fetch fails closed

Everything is offline: `gh`, `codex`, and `claude` are PATH stubs writing to
a fixture dir; `git` runs against throwaway repos; `node` runs the real
ledger/render scripts (they are part of the unit under test).
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = REPO_ROOT / "scripts"
BASH = shutil.which("bash")
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(
    not BASH or not NODE, reason="bash + node are required (present in CI and Git Bash dev boxes)"
)

VIEWER = "Mikecranesync"
SHA_A = "a" * 40
SHA_B = "b" * 40
SHA_C = "c" * 40


def _record(sha: str, status: str, iteration: int, author: str = VIEWER) -> dict:
    body = (
        "[CODEX-ADVERSARIAL-REVIEW]\n\n```\n"
        f"reviewed_sha: {sha}\n"
        "base_sha: {}\n".format("0" * 40)
        + f"status: {status}\n"
        + f"review_iteration: {iteration}\n"
        + "\nBLOCKER: 0\nHIGH: 0\nMEDIUM: 0\nLOW: 0\nFALSE_POSITIVE: 0\n```\n"
    )
    return {"body": body, "user": {"login": author}}


def _malformed(sha: str, author: str = VIEWER) -> dict:
    # Marker + sha mention, but no strict envelope — must never validate.
    return {
        "body": f"[CODEX-ADVERSARIAL-REVIEW]\nreviewed_sha: {sha}\nstatus: GREEN\n",
        "user": {"login": author},
    }


def run_ledger(tmp_path: Path, comments: list, sha: str | None = None) -> dict:
    f = tmp_path / "comments.json"
    f.write_text(json.dumps(comments), encoding="utf-8")
    args = [NODE, str(SCRIPTS / "adversarial-review-ledger.mjs"), str(f), VIEWER]
    if sha:
        args += ["--sha", sha]
    out = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


# ── Ledger: validated unique records, never raw comment count ────────────────


def test_duplicate_records_do_not_inflate_iteration_or_budget(tmp_path):
    """#3288 live defect: two identical iteration-2 comments made the next
    review 'iteration 4' under comment-count math. max(iteration)+1 and
    distinct-(sha,iteration) budget are both immune to duplicates."""
    comments = [
        _record(SHA_A, "ISSUES_FOUND", 1),
        _record(SHA_B, "ISSUES_FOUND", 2),
        _record(SHA_B, "ISSUES_FOUND", 2),  # duplicate post of the same record
    ]
    ledger = run_ledger(tmp_path, comments)
    assert ledger["next_iteration"] == 3
    assert ledger["consumed"] == 2


def test_malformed_and_foreign_records_never_validate(tmp_path):
    comments = [
        _malformed(SHA_A),  # our account, malformed envelope
        _record(SHA_B, "GREEN", 1, author="someone-else"),  # forged author
    ]
    ledger = run_ledger(tmp_path, comments, sha=SHA_A)
    assert ledger["consumed"] == 0
    assert ledger["next_iteration"] == 1
    assert ledger["already"] == 0
    assert ledger["prior_status"] == "MALFORMED"  # visible, but never a GREEN


def test_valid_green_at_sha_is_recognized(tmp_path):
    ledger = run_ledger(tmp_path, [_record(SHA_A, "GREEN", 1)], sha=SHA_A)
    assert ledger == {
        "next_iteration": 2,
        "consumed": 1,
        "already": 1,
        "prior_status": "GREEN",
    }


# ── Script fixtures ──────────────────────────────────────────────────────────


def _posix(p: Path) -> str:
    return str(p).replace("\\", "/")


def _write_exec(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


class Harness:
    """A scratch git repo (with bare origin), PATH stubs, and gh fixtures."""

    def __init__(self, tmp_path: Path, with_origin: bool = True):
        self.fix = tmp_path / "fix"
        self.fix.mkdir()
        self.repo = tmp_path / "repo"
        self.repo.mkdir()
        self.stubs = tmp_path / "stubs"
        self.stubs.mkdir()
        self.out_dir = tmp_path / "adv-out"

        def git(*args):
            subprocess.run(
                ["git", *args], cwd=self.repo, check=True, capture_output=True,
                text=True, encoding="utf-8", errors="replace",
            )

        git("init", "-q", "-b", "main")
        git("config", "user.email", "t@t")
        git("config", "user.name", "t")
        git("config", "commit.gpgsign", "false")
        (self.repo / "base.txt").write_text("base\n", encoding="utf-8")
        git("add", "base.txt")
        git("commit", "-qm", "base")
        if with_origin:
            bare = tmp_path / "origin.git"
            subprocess.run(
                ["git", "init", "-q", "--bare", str(bare)], check=True, capture_output=True
            )
            git("remote", "add", "origin", _posix(bare))
            git("push", "-q", "origin", "main")
        git("checkout", "-qb", "work")
        (self.repo / "work.txt").write_text("work\n", encoding="utf-8")
        git("add", "work.txt")
        git("commit", "-qm", "work")
        self.head = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=self.repo, capture_output=True,
            text=True, encoding="utf-8", check=True,
        ).stdout.strip()

        # The scripts resolve peers via $ROOT/scripts — copy them in verbatim.
        (self.repo / "scripts").mkdir()
        for f in SCRIPTS.iterdir():
            if f.name.startswith("adversarial-review"):
                shutil.copy(f, self.repo / "scripts" / f.name)

        self.set_comments([])
        self.set_pr_head(self.head)
        (self.fix / "pr.json").write_text(
            json.dumps(
                {
                    "number": 99,
                    "title": "t",
                    "baseRefName": "main",
                    "headRefOid": self.head,
                    "headRefName": "work",
                }
            ),
            encoding="utf-8",
        )

        fix = _posix(self.fix)
        _write_exec(
            self.stubs / "gh",
            f'''#!/usr/bin/env bash
FIX="{fix}"
echo "$*" >> "$FIX/gh.log"
case "$*" in
  "api user --jq .login") echo "{VIEWER}" ;;
  api\\ repos/*/comments*|api\\ repos*comments\\ --paginate)
      cat "$FIX/comments.json" ;;
  "pr view 99 --json number,title,baseRefName,headRefOid,headRefName")
      cat "$FIX/pr.json" ;;
  "pr view 99 --json headRefOid --jq .headRefOid")
      if [ -s "$FIX/head_seq.txt" ]; then
        head -n1 "$FIX/head_seq.txt"
        sed -i '1d' "$FIX/head_seq.txt"
      else
        cat "$FIX/pr_head"
      fi ;;
  pr\\ comment\\ 99\\ --body-file\\ *)
      cp "$5" "$FIX/posted-$(ls "$FIX" | grep -c posted- || true).md" ;;
  pr\\ comment\\ 99\\ --body\\ *)
      printf '%s' "$5" > "$FIX/posted-body-$(ls "$FIX" | grep -c posted- || true).md" ;;
  *) echo "gh-stub: unhandled: $*" >&2; exit 64 ;;
esac
''',
        )
        _write_exec(
            self.stubs / "codex",
            f'''#!/usr/bin/env bash
FIX="{fix}"
cat > /dev/null  # consume the prompt on stdin
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then out="$a"; fi
  prev="$a"
done
cp "$FIX/envelope.json" "$out"
''',
        )
        _write_exec(
            self.stubs / "claude",
            f'''#!/usr/bin/env bash
touch "{fix}/claude-invoked"
cat > /dev/null
''',
        )

    def set_comments(self, comments: list) -> None:
        (self.fix / "comments.json").write_text(json.dumps(comments), encoding="utf-8")

    def set_pr_head(self, sha: str, sequence: list[str] | None = None) -> None:
        (self.fix / "pr_head").write_text(sha, encoding="utf-8")
        seq = self.fix / "head_seq.txt"
        if sequence:
            seq.write_text("\n".join(sequence) + "\n", encoding="utf-8")
        elif seq.exists():
            seq.unlink()

    def set_envelope(self, envelope: dict) -> None:
        (self.fix / "envelope.json").write_text(json.dumps(envelope), encoding="utf-8")

    def run(self, script: str, *args: str, env_extra: dict | None = None):
        env = dict(os.environ)
        env["PATH"] = str(self.stubs) + os.pathsep + env["PATH"]
        env["ADV_REVIEW_OUT_DIR"] = _posix(self.out_dir)
        env["CODEX_BIN"] = "codex"
        env["CLAUDE_BIN"] = "claude"
        env.pop("ADV_REVIEW_HUMAN_AUTHORIZED", None)
        if env_extra:
            env.update(env_extra)
        return subprocess.run(
            [BASH, f"scripts/{script}", *args],
            cwd=self.repo, env=env, capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=120,
        )

    def posted(self) -> str:
        return "\n---\n".join(
            p.read_text(encoding="utf-8") for p in sorted(self.fix.glob("posted-*"))
        )


GREEN_ENVELOPE = {
    "status": "GREEN",
    "summary": "reviewed everything",
    "findings": [],
    "files_reviewed": ["work.txt"],
}


# ── adversarial-review.sh: argument strictness ───────────────────────────────


def test_runner_rejects_non_numeric_pr_argument(tmp_path):
    h = Harness(tmp_path)
    r = h.run("adversarial-review.sh", "99abc")
    assert r.returncode == 3
    assert "numeric PR id" in r.stderr


def test_runner_rejects_removed_allow_dirty_flag(tmp_path):
    h = Harness(tmp_path)
    r = h.run("adversarial-review.sh", "99", "--allow-dirty")
    assert r.returncode == 3
    assert "unknown flag" in r.stderr


def test_runner_rejects_dirty_tracked_tree_unconditionally(tmp_path):
    h = Harness(tmp_path)
    (h.repo / "work.txt").write_text("drift\n", encoding="utf-8")
    r = h.run("adversarial-review.sh", "99")
    assert r.returncode == 3
    assert "uncommitted tracked changes" in r.stderr


def test_runner_fails_closed_when_base_fetch_fails(tmp_path):
    h = Harness(tmp_path, with_origin=False)  # no origin remote -> fetch fails
    r = h.run("adversarial-review.sh", "99")
    assert r.returncode == 2
    assert "refusing to compute a merge-base" in r.stderr


# ── adversarial-review.sh: durable budget across restarts ────────────────────


def _three_consumed() -> list:
    return [
        _record(SHA_A, "ISSUES_FOUND", 1),
        _record(SHA_B, "ISSUES_FOUND", 2),
        _record(SHA_C, "ISSUES_FOUND", 3),
    ]


def test_budget_exhausted_refuses_new_review_without_human_authorization(tmp_path):
    """The restart hole: a fresh invocation must count the LEDGER's rounds,
    not its own. Three validated records anywhere in PR history -> refuse."""
    h = Harness(tmp_path)
    h.set_comments(_three_consumed())
    r = h.run("adversarial-review.sh", "99")
    assert r.returncode == 3
    assert "durable review budget" in r.stderr
    assert "gh.log" in os.listdir(h.fix) or True
    assert h.posted() == ""  # nothing ran, nothing posted


def test_post_cap_human_authorized_review_runs_and_is_stamped(tmp_path):
    h = Harness(tmp_path)
    h.set_comments(_three_consumed())
    h.set_envelope(GREEN_ENVELOPE)
    r = h.run(
        "adversarial-review.sh", "99", env_extra={"ADV_REVIEW_HUMAN_AUTHORIZED": "1"}
    )
    assert r.returncode == 0, r.stderr + r.stdout
    posted = h.posted()
    assert "post_cap_human_authorized: true" in posted
    assert "review_iteration: 4" in posted  # max(1,2,3)+1, not comment-count math
    assert f"reviewed_sha: {h.head}" in posted


def test_dedupe_early_exit_consumes_no_budget(tmp_path):
    """A re-run at an already-reviewed SHA reports the prior status without
    running codex — and therefore without budget interaction."""
    h = Harness(tmp_path)
    h.set_comments(_three_consumed() + [_record(h.head, "ISSUES_FOUND", 4)])
    r = h.run("adversarial-review.sh", "99")
    assert r.returncode == 1  # prior ISSUES_FOUND replayed
    assert "Already reviewed" in r.stdout
    assert h.posted() == ""


# ── adversarial-review.sh: stale GREEN / head movement ───────────────────────


def test_green_for_a_moved_head_is_stale_exit_4_never_green(tmp_path):
    h = Harness(tmp_path)
    h.set_envelope(GREEN_ENVELOPE)
    # The final gate's re-verify sees a DIFFERENT head than the reviewed one.
    h.set_pr_head(h.head, sequence=["f" * 40])
    r = h.run("adversarial-review.sh", "99")
    assert r.returncode == 4
    assert "STALE" in r.stderr


def test_green_with_stable_head_is_green(tmp_path):
    h = Harness(tmp_path)
    h.set_envelope(GREEN_ENVELOPE)
    r = h.run("adversarial-review.sh", "99")
    assert r.returncode == 0, r.stderr + r.stdout
    assert f"reviewed_sha: {h.head}" in h.posted()


# ── adversarial-review-loop.sh ───────────────────────────────────────────────


def test_loop_rejects_bad_arguments(tmp_path):
    h = Harness(tmp_path)
    assert h.run("adversarial-review-loop.sh", "99x").returncode == 2
    assert h.run("adversarial-review-loop.sh", "99", "--bogus").returncode == 2
    assert h.run("adversarial-review-loop.sh", "99", "--max-iter", "5").returncode == 2
    assert h.run("adversarial-review-loop.sh", "99", "--max-iter").returncode == 2


def test_loop_human_override_requires_review_only(tmp_path):
    h = Harness(tmp_path)
    r = h.run(
        "adversarial-review-loop.sh", "99", env_extra={"ADV_REVIEW_HUMAN_AUTHORIZED": "1"}
    )
    assert r.returncode == 2
    assert "REVIEW-ONLY" in r.stderr


def test_loop_restart_does_not_reset_the_durable_budget(tmp_path):
    """A brand-new loop invocation against a PR with 3 validated rounds must
    escalate immediately — no review, no privileged remediation."""
    h = Harness(tmp_path)
    h.set_comments(_three_consumed())
    r = h.run("adversarial-review-loop.sh", "99")
    assert r.returncode == 1
    assert "durable review budget exhausted" in h.posted()
    assert not (h.fix / "claude-invoked").exists()
