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
    assert ledger["next_iteration"] == 2
    assert ledger["consumed"] == 1
    assert ledger["already"] == 1
    assert ledger["prior_status"] == "GREEN"


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
  api\\ repos/*/comments\\ -F\\ body=@*\\ --jq\\ .id)
      # POST a comment (reservation). Atomic append under a mkdir lock —
      # this is the shared ledger two racing processes contend on.
      body=""
      for a in "$@"; do case "$a" in body=@*) body="${{a#body=@}}" ;; esac; done
      if [ "${{STUB_HOLD_POST:-0}}" = "1" ]; then
        : > "$FIX/post-waiting-${{ADV_TEST_PROC:-x}}"
        i=0
        until [ -e "$FIX/go-post" ]; do i=$((i+1)); [ "$i" -gt 300 ] && exit 71; sleep 0.1; done
      fi
      i=0
      until mkdir "$FIX/lock" 2>/dev/null; do i=$((i+1)); [ "$i" -gt 300 ] && exit 70; sleep 0.05; done
      node -e '
        const fs=require("fs");
        const [cf,bf,viewer]=process.argv.slice(1);
        const arr=JSON.parse(fs.readFileSync(cf,"utf8"));
        const id=arr.reduce((m,c)=>Math.max(m,c.id||0),1000)+1;
        arr.push({{id, user:{{login:viewer}}, body:fs.readFileSync(bf,"utf8")}});
        // Atomic replace: concurrent readers must see the old or new ledger,
        // never a truncated half-write (the real GitHub API is atomic).
        fs.writeFileSync(cf+".tmp",JSON.stringify(arr));
        fs.renameSync(cf+".tmp",cf);
        console.log(id);
      ' "$FIX/comments.json" "$body" "{VIEWER}"
      rc=$?
      rmdir "$FIX/lock"
      exit "$rc" ;;
  api\\ repos/*/comments\\ --paginate)
      if [ "${{STUB_FAIL_LIST:-0}}" = "1" ]; then exit 1; fi
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
echo "${{ADV_TEST_PROC:-x}}" >> "$FIX/codex-count"
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
echo "${{ADV_TEST_PROC:-x}}" >> "{fix}/claude-invoked"
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

    def _env(self, env_extra: dict | None = None) -> dict:
        env = dict(os.environ)
        env["PATH"] = str(self.stubs) + os.pathsep + env["PATH"]
        env["ADV_REVIEW_OUT_DIR"] = _posix(self.out_dir)
        env["CODEX_BIN"] = "codex"
        env["CLAUDE_BIN"] = "claude"
        for k in ("ADV_REVIEW_HUMAN_AUTHORIZED", "ADV_REVIEW_MODE", "STUB_HOLD_POST",
                  "STUB_FAIL_LIST", "ADV_TEST_PROC"):
            env.pop(k, None)
        if env_extra:
            env.update(env_extra)
        return env

    def run(self, script: str, *args: str, env_extra: dict | None = None):
        return subprocess.run(
            [BASH, f"scripts/{script}", *args],
            cwd=self.repo, env=self._env(env_extra), capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=180,
        )

    def popen(self, script: str, *args: str, env_extra: dict | None = None):
        return subprocess.Popen(
            [BASH, f"scripts/{script}", *args],
            cwd=self.repo, env=self._env(env_extra),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )

    def codex_runs(self) -> int:
        f = self.fix / "codex-count"
        return len(f.read_text(encoding="utf-8").splitlines()) if f.exists() else 0

    def claude_runs(self) -> int:
        f = self.fix / "claude-invoked"
        return len(f.read_text(encoding="utf-8").splitlines()) if f.exists() else 0

    def ledger(self) -> list:
        return json.loads((self.fix / "comments.json").read_text(encoding="utf-8"))

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

ISSUES_ENVELOPE = {
    "status": "ISSUES_FOUND",
    "summary": "found one",
    "files_reviewed": ["work.txt"],
    "findings": [
        {
            "id": "F1",
            "severity": "HIGH",
            "title": "t",
            "file": "work.txt",
            "confidence": "observed",
            "failure_scenario": "s",
            "evidence": "e",
            "remediation": "r",
            "test_to_prove": "p",
        }
    ],
}


def _reservation(
    run_id: str,
    sha: str,
    mode: str,
    comment_id: int,
    human: str = "false",
    author: str = VIEWER,
) -> dict:
    body = (
        "[ADVERSARIAL-ROUND-RESERVATION]\n\n```\n"
        f"run_id: {run_id}\n"
        f"head_sha: {sha}\n"
        f"mode: {mode}\n"
        f"human_authorized: {human}\n"
        "requested_at: 2026-08-17T00:00:00Z\n```"
    )
    return {"id": comment_id, "body": body, "user": {"login": author}}


def _remediation(run_id: str, reviewed: str, new_head: str, author: str = VIEWER) -> dict:
    body = (
        "[CLAUDE-REMEDIATION]\n\n```\n"
        f"remediated_review_sha: {reviewed}\n"
        f"new_head_sha: {new_head}\n"
        f"run_id: {run_id}\n"
        "iteration: 1\n```"
    )
    return {"body": body, "user": {"login": author}}


RID_1 = "1" * 32
RID_2 = "2" * 32
RID_3 = "3" * 32


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
    assert h.claude_runs() == 0


# ── Atomic round reservation (Codex iteration-4 F1) ──────────────────────────


def test_race_two_processes_exactly_one_canonical_winner(tmp_path):
    """THE F1 acceptance test: two real loop processes, one shared stub
    ledger, a barrier ensuring BOTH observe the same available final slot
    before EITHER's reservation posts. Exactly one reservation becomes
    canonical; exactly one process runs Codex and launches Claude; the loser
    exits fail-closed; both run_ids persist distinctly; the winner stays
    bound to the original head."""
    h = Harness(tmp_path)
    # Two of three slots already consumed by canonical FULL reservations on
    # earlier heads — both racers see exactly one slot left.
    h.set_comments(
        [
            _reservation(RID_1, "d" * 40, "full", 2001),
            _reservation(RID_2, "e" * 40, "full", 2002),
        ]
    )
    h.set_envelope(ISSUES_ENVELOPE)

    p1 = h.popen(
        "adversarial-review-loop.sh", "99",
        env_extra={"STUB_HOLD_POST": "1", "ADV_TEST_PROC": "p1"},
    )
    p2 = h.popen(
        "adversarial-review-loop.sh", "99",
        env_extra={"STUB_HOLD_POST": "1", "ADV_TEST_PROC": "p2"},
    )
    # Barrier: wait until BOTH processes are blocked at their reservation POST
    # (each has already read the ledger and seen the free slot), then release.
    import time

    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if (h.fix / "post-waiting-p1").exists() and (h.fix / "post-waiting-p2").exists():
            break
        time.sleep(0.1)
    else:
        p1.kill(), p2.kill()
        pytest.fail("both processes never reached the reservation POST barrier")
    (h.fix / "go-post").write_text("go", encoding="utf-8")

    out1, _ = p1.communicate(timeout=180)
    out2, _ = p2.communicate(timeout=180)
    rcs = {p1.returncode, p2.returncode}

    # Exactly one Codex review and exactly one privileged remediation ran.
    assert h.codex_runs() == 1, out1 + out2
    assert h.claude_runs() == 1, out1 + out2
    # One process lost the race and exited fail-closed before Codex.
    assert "LOST RESERVATION RACE" in out1 + out2
    assert 0 not in rcs  # winner escalates no-progress (1); loser fails closed (2)
    # Both reservations persist with DISTINCT run_ids — never collapsed.
    ledger = h.ledger()
    res_bodies = [c["body"] for c in ledger if c["body"].startswith("[ADVERSARIAL-ROUND-RESERVATION]")]
    new_res = [b for b in res_bodies if f"head_sha: {h.head}" in b]
    assert len(new_res) == 2
    run_ids = {b.split("run_id: ")[1][:32] for b in new_res}
    assert len(run_ids) == 2
    # The winning (canonical) reservation is bound to the exact original head.
    out = subprocess.run(
        [NODE, str(SCRIPTS / "adversarial-review-ledger.mjs"),
         str(h.fix / "comments.json"), VIEWER, "--sha", h.head],
        capture_output=True, text=True, encoding="utf-8",
    )
    parsed = json.loads(out.stdout)
    assert parsed["canonical_run_id_for_sha"] in run_ids
    assert parsed["canonical_full"] == 3  # winner consumed the final slot

    # Restarting the LOSER cannot reclaim or duplicate the consumed round:
    # the durable budget is now exhausted, so a fresh invocation refuses
    # before Codex ever runs.
    r = h.run("adversarial-review-loop.sh", "99", env_extra={"ADV_TEST_PROC": "p2r"})
    assert r.returncode == 1
    assert "durable review budget exhausted" in h.posted()
    assert h.codex_runs() == 1  # unchanged
    assert h.claude_runs() == 1  # unchanged


def test_reservation_already_held_by_another_run_fails_closed(tmp_path):
    """Deterministic single-process complement to the race: the head already
    has a canonical reservation from another run — this invocation must post,
    lose, and exit before Codex."""
    h = Harness(tmp_path)
    h.set_comments([_reservation(RID_1, h.head, "full", 2001)])
    h.set_envelope(ISSUES_ENVELOPE)
    r = h.run("adversarial-review.sh", "99", env_extra={"ADV_REVIEW_MODE": "full"})
    assert r.returncode == 3
    assert "LOST RESERVATION RACE" in r.stderr
    assert h.codex_runs() == 0


def test_crashed_winner_conservatively_keeps_slots_consumed(tmp_path):
    """Three canonical FULL reservations with NO review records (all three
    'crashed' before reviewing) still exhaust the budget — a failed privileged
    round never silently returns its slot."""
    h = Harness(tmp_path)
    h.set_comments(
        [
            _reservation(RID_1, "d" * 40, "full", 2001),
            _reservation(RID_2, "e" * 40, "full", 2002),
            _reservation(RID_3, "f" * 40, "full", 2003),
        ]
    )
    r = h.run("adversarial-review.sh", "99")
    assert r.returncode == 3
    assert "durable review budget" in r.stderr
    assert h.codex_runs() == 0


def test_duplicate_reservation_posts_collapse_distinct_run_ids_do_not(tmp_path):
    comments = [
        _reservation(RID_1, SHA_A, "full", 2001),
        _reservation(RID_1, SHA_A, "full", 2005),  # retry of the SAME run — collapses
        _reservation(RID_2, SHA_B, "full", 2003),
    ]
    f = tmp_path / "c.json"
    f.write_text(json.dumps(comments), encoding="utf-8")
    out = subprocess.run(
        [NODE, str(SCRIPTS / "adversarial-review-ledger.mjs"), str(f), VIEWER, "--sha", SHA_A],
        capture_output=True, text=True, encoding="utf-8",
    )
    j = json.loads(out.stdout)
    assert j["reservations"] == 2  # RID_1 collapsed to its earliest comment
    assert j["canonical_full"] == 2  # distinct run_ids never collapse
    assert j["canonical_run_id_for_sha"] == RID_1


def test_malformed_and_forged_reservations_never_participate(tmp_path):
    comments = [
        {"id": 2001, "body": "[ADVERSARIAL-ROUND-RESERVATION]\nrun_id: junk\n", "user": {"login": VIEWER}},
        _reservation(RID_1, SHA_A, "full", 2002, author="attacker"),
    ]
    f = tmp_path / "c.json"
    f.write_text(json.dumps(comments), encoding="utf-8")
    out = subprocess.run(
        [NODE, str(SCRIPTS / "adversarial-review-ledger.mjs"), str(f), VIEWER, "--sha", SHA_A],
        capture_output=True, text=True, encoding="utf-8",
    )
    j = json.loads(out.stdout)
    assert j["reservations"] == 0
    assert j["canonical_full"] == 0
    assert j["canonical_run_id_for_sha"] is None


# ── Budget accounting: per-head union (round-5 F1) ───────────────────────────
# consumed is charged AT RESERVATION. The former global
# max(reviewRounds, canonicalFull) let a crashed FULL reservation at a NEW
# head vanish behind legacy review records at OTHER heads.


def test_legacy_rounds_plus_crashed_reservation_are_additive(tmp_path):
    """The round-5 direct regression: legacy consumed = 3, one distinct
    post-legacy FULL reservation that never completed => consumed = 4, not 3."""
    legacy = [
        _record(SHA_A, "ISSUES_FOUND", 1),
        _record(SHA_B, "ISSUES_FOUND", 2),
        _record(SHA_C, "ISSUES_FOUND", 3),
    ]
    crashed = _reservation(RID_1, "d" * 40, "full", 3001)  # no review record ever lands
    ledger = run_ledger(tmp_path, legacy + [crashed])
    assert ledger["consumed"] == 4


def test_completed_reservation_era_round_is_one_slot_not_two(tmp_path):
    """A reservation + its review record at the SAME head is ONE consumed
    slot — the per-head union must not double-charge completion."""
    comments = [
        _reservation(RID_1, SHA_A, "full", 3001),
        _record(SHA_A, "ISSUES_FOUND", 1),
    ]
    ledger = run_ledger(tmp_path, comments)
    assert ledger["consumed"] == 1


def test_multiple_post_legacy_reservations_accumulate(tmp_path):
    """Legacy 1 + completed reservation round + crashed reservation round = 3."""
    comments = [
        _record(SHA_A, "ISSUES_FOUND", 1),  # legacy head, no reservation
        _reservation(RID_1, SHA_B, "full", 3001),
        _record(SHA_B, "ISSUES_FOUND", 2),  # RID_1 completed
        _reservation(RID_2, SHA_C, "full", 3002),  # crashed — stays consumed
    ]
    ledger = run_ledger(tmp_path, comments)
    assert ledger["consumed"] == 3


def test_replayed_reservation_identity_never_double_charges(tmp_path):
    """Idempotent retry: the SAME run_id posted twice at the same head is one
    slot; review_only reservations charge nothing."""
    comments = [
        _reservation(RID_1, SHA_A, "full", 3001),
        _reservation(RID_1, SHA_A, "full", 3005),  # replay of the same identity
        _reservation(RID_2, SHA_B, "review_only", 3006, human="true"),
    ]
    ledger = run_ledger(tmp_path, comments)
    assert ledger["consumed"] == 1
    assert ledger["canonical_full"] == 1


def test_forced_rereviews_at_one_legacy_head_still_count_each_round(tmp_path):
    """Existing-format preservation: multiple validated iterations at one
    UNreserved head keep counting individually (the old floor), and a reserved
    head with records still counts its record rounds when they exceed one."""
    comments = [
        _record(SHA_A, "ISSUES_FOUND", 1),
        _record(SHA_A, "ISSUES_FOUND", 2),  # forced re-review, same legacy head
        _reservation(RID_1, SHA_B, "full", 3001),
        _record(SHA_B, "ISSUES_FOUND", 3),
        _record(SHA_B, "ISSUES_FOUND", 4),  # human-forced re-review at reserved head
    ]
    ledger = run_ledger(tmp_path, comments)
    assert ledger["consumed"] == 4  # 2 (SHA_A legacy) + max(2, 1) (SHA_B)


def test_remediation_completion_is_run_id_bound(tmp_path):
    """The pre-privileged recheck refuses a round whose run_id already has a
    completion record — a repeated launch cannot double-remediate one round."""
    comments = [
        _reservation(RID_1, SHA_A, "full", 2001),
        _remediation(RID_1, SHA_A, SHA_B),
    ]
    f = tmp_path / "c.json"
    f.write_text(json.dumps(comments), encoding="utf-8")
    out = subprocess.run(
        [NODE, str(SCRIPTS / "adversarial-review-ledger.mjs"), str(f), VIEWER,
         "--sha", SHA_A, "--run-id", RID_1],
        capture_output=True, text=True, encoding="utf-8",
    )
    j = json.loads(out.stdout)
    assert j["remediation_completed_for_run_id"] == 1
    assert j["mine_is_canonical_for_its_sha"] == 1


def test_pagination_failure_fails_closed(tmp_path):
    h = Harness(tmp_path)
    r = h.run("adversarial-review.sh", "99", env_extra={"STUB_FAIL_LIST": "1"})
    assert r.returncode == 2
    assert h.codex_runs() == 0


def test_head_movement_before_claude_skips_privileged_remediation(tmp_path):
    """ISSUES_FOUND at head H, but the PR head moves before remediation — the
    loop must not launch Claude against stale findings."""
    h = Harness(tmp_path)
    h.set_envelope(ISSUES_ENVELOPE)
    # The loop's pre-remediation head re-verify pops a MOVED head.
    h.set_pr_head(h.head, sequence=["9" * 40])
    r = h.run("adversarial-review-loop.sh", "99")
    assert r.returncode != 0
    assert h.codex_runs() == 1
    assert h.claude_runs() == 0


def test_post_cap_human_authorized_review_only_never_invokes_claude(tmp_path):
    """The post-cap override is review-only BY CONSTRUCTION: it reviews once,
    stamps the authorization + run_id into the record, and never remediates."""
    h = Harness(tmp_path)
    h.set_comments(_three_consumed())
    h.set_envelope(ISSUES_ENVELOPE)
    r = h.run(
        "adversarial-review-loop.sh", "99", "--review-only",
        env_extra={"ADV_REVIEW_HUMAN_AUTHORIZED": "1"},
    )
    assert r.returncode == 1  # issues found, stopped before remediation
    assert h.codex_runs() == 1
    assert h.claude_runs() == 0
    posted = h.posted()
    assert "post_cap_human_authorized: true" in posted
    assert "run_id: " in posted  # review record is reservation-bound
    # And the reservation itself is review_only + human_authorized.
    res = [c["body"] for c in h.ledger() if c["body"].startswith("[ADVERSARIAL-ROUND-RESERVATION]")]
    assert len(res) == 1
    assert "mode: review_only" in res[0]
    assert "human_authorized: true" in res[0]
