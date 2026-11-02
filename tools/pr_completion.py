#!/usr/bin/env python3
"""PR completion controller: drive one PR to an evidence-backed GREEN, BLOCKED
or NEEDS_APPROVAL verdict using only the existing gates (docs/pr-completion-workflow.md).

    git show "origin/main:tools/pr_completion.py" > /tmp/prc.py
    python3 -I /tmp/prc.py PR [--mode review|full] [--max-cycles N] [--no-followups]

Each cycle re-derives every gate from primary sources at the exact PR head and
body: check runs and statuses for that SHA, the base-blob lifecycle guard, and
the owner-authored review ledger parsed by the base-blob ledger script. A
status comment this tool posts is output only and is never read back.

It never merges, deploys, migrates, edits flags or protections, or dispatches
any workflow except the lifecycle guard. Reviews and fixes go through the
trusted entrypoint loaded from the PR's captured base object.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

GUARD_CHECK = "Legacy UI Lifecycle Guard"
GUARD_REVIEW_ITEM = "review:exact-head and exact-body Codex GREEN"
MAX_ROUNDS = 3  # durable Codex budget per PR (docs/adversarial-review-workflow.md)
PAID_WORKFLOWS = (".github/workflows/beta-gate.yml",)  # pull_request runs that spend money
NEEDS_AUTH = (
    "*/db/migrations/*",
    ".github/*",
    "docker-compose*",
    "deployment/*",
    "*nginx*",
    "*Dockerfile*",
    "*doppler*",
    "*.env*",
    "*secret*",
    "*credential*",
    "CODEOWNERS",
    "scripts/adversarial-review*",
    "tools/ui_surface_lifecycle_guard.py",
    "tools/pr_completion.py",
    "tools/hooks/*",
    "*/install/*",
)
HUMAN_SAFETY = ("*plc*", "*PLC*", "*modbus*", "*ladder*", "*interlock*", "*lockout*", "*safety*")
LOW_RISK = (
    "docs/*",
    "*.md",
    "tests/*",
    "*/__tests__/*",
    "*.test.ts",
    "*.test.tsx",
    "*_test.py",
    "test_*.py",
    "*.png",
    "*/factorylm-ui/*",
)
REVIEW_RE = re.compile(
    r"^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\n"
    r"reviewed_body_sha256: ([0-9a-f]{64})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\n"
    r"review_iteration: [0-9]+\r?\n(?:post_cap_human_authorized: true\r?\n)?"
    r"(?:run_id: [0-9a-f]{32}\r?\nreservation_comment_id: [1-9][0-9]*\r?\n)?\r?\n"
    r"BLOCKER: ([0-9]+)\r?\nHIGH: ([0-9]+)\r?\nMEDIUM: ([0-9]+)\r?\n"
)
FOLLOWUPS_RE = re.compile(
    r"^\[REVIEW-FOLLOWUPS\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\n"
    r"reviewed_body_sha256: ([0-9a-f]{64})\r?\nissues:((?: #[0-9]+)+)\r?\n```"
)
FINDING_RE = re.compile(r"^### (F[0-9]+) · MEDIUM · (.+)$", re.M)


class Blocked(Exception):
    """A gate cannot be decided; the run ends BLOCKED with this reason."""


def run(argv, *, stdin=None, check=True, timeout=600):
    p = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=timeout)
    if check and p.returncode != 0:
        raise Blocked(
            f"tooling: {' '.join(argv[:3])} failed rc={p.returncode}: {p.stderr.strip()[:200]}"
        )
    return p


def gh(*args, stdin=None):
    """Every GitHub call passes this allowlist; anything else is a bug, not a request."""
    a = list(args)
    writes = ("-X", "--method", "-f", "-F", "--field", "--raw-field", "--input")
    ok = (
        a[:2] in (["pr", "view"], ["pr", "comment"], ["issue", "create"])
        or (
            len(a) == 7
            and a[:6] == ["workflow", "run", "ui-lifecycle-guard.yml", "--ref", "main", "-f"]
            and re.fullmatch(r"pr_number=[0-9]+", a[6])
        )
        or (a[:1] == ["api"] and not any(x.startswith(writes) for x in a[1:]))
    )
    if not ok or "merge" in a:
        raise Blocked(f"refused non-allowlisted GitHub call: gh {' '.join(a[:3])}")
    return run(["gh", *a], stdin=stdin).stdout


def concat_json(raw):  # gh --paginate emits concatenated arrays
    return (
        json.loads("[" + re.sub(r"\]\s*\[", ",", raw.strip()).strip("[]") + "]")
        if raw.strip()
        else []
    )


def match_any(path, pats):
    return any(
        fnmatch.fnmatch(path, p) or fnmatch.fnmatch(path.rsplit("/", 1)[-1], p) for p in pats
    )


def risk_tier(files):
    """human_safety > needs_authorization > backend > low (policy in the workflow doc)."""
    if any(match_any(f, HUMAN_SAFETY) for f in files):
        return "human_safety", sorted(f for f in files if match_any(f, HUMAN_SAFETY))
    hits = sorted(f for f in files if match_any(f, NEEDS_AUTH))
    if hits:
        return "needs_authorization", hits
    if all(match_any(f, LOW_RISK) for f in files):
        return "low", []
    return "backend", []


def paid_paths(base, files):
    """Files that make a pull_request push fire a paid workflow, from the base YAML.

    Fails closed: an unreadable or unparsable workflow, or a pull_request trigger without a
    path filter, counts every changed file as paid."""
    hits = []
    for wf in PAID_WORKFLOWS:
        p = run(["git", "show", f"{base}:{wf}"], check=False)
        if p.returncode != 0:
            continue  # the workflow does not exist at this base
        try:
            import yaml

            doc = yaml.safe_load(p.stdout) or {}
            on = doc.get("on", doc.get(True)) or {}
            pr = on.get("pull_request", None) if isinstance(on, dict) else None
            if pr is None and not (isinstance(on, (list, str)) and "pull_request" in on):
                continue
            globs = (pr or {}).get("paths")
            if not isinstance(globs, list):
                return sorted(files)
        except Exception:  # noqa: BLE001 - any parse failure is treated as paid
            return sorted(files)
        hits += [
            f for f in files if any(fnmatch.fnmatch(f, str(g).replace("**", "*")) for g in globs)
        ]
    return sorted(set(hits))


def snapshot(pr):
    j = json.loads(
        gh(
            "pr",
            "view",
            str(pr),
            "--json",
            "state,isDraft,headRefOid,baseRefOid,baseRefName,body,files",
        )
    )
    body = j.get("body") or ""
    if j["state"] != "OPEN" or not re.fullmatch(r"[0-9a-f]{40}", j["headRefOid"] or ""):
        raise Blocked(f"PR is {j['state']} or has no exact head")
    return {
        "head": j["headRefOid"],
        "base": j["baseRefOid"],
        "base_ref": j["baseRefName"],
        "draft": j["isDraft"],
        "body": body,
        "files": sorted(f["path"] for f in j["files"]),
        "body_sha256": hashlib.sha256(body.encode()).hexdigest(),
    }


def ci_state(snap, required, timeout_s, poll_s):
    """Wait until every check at the exact head is terminal; return (failed, missing_required)."""
    deadline = time.monotonic() + timeout_s
    while True:
        runs = json.loads(
            gh("api", f"repos/{{owner}}/{{repo}}/commits/{snap['head']}/check-runs?per_page=100")
        )
        if runs.get("total_count", 0) > len(runs.get("check_runs", [])):
            raise Blocked("tooling: more than 100 check runs; refusing a partial CI read")
        run_latest = {}
        for c in sorted(runs["check_runs"], key=lambda c: c["id"]):
            run_latest[c["name"]] = (c["status"], c["conclusion"])
        latest = dict(run_latest)
        for s in reversed(
            concat_json(
                gh("api", f"repos/{{owner}}/{{repo}}/commits/{snap['head']}/statuses?per_page=100")
            )
        ):
            status = (
                "completed" if s["state"] != "pending" else "pending",
                {"success": "success", "pending": None}.get(s["state"], "failure"),
            )
            run_result = run_latest.get(s["context"])
            # A same-named status never hides a failed or pending check run, except the
            # lifecycle guard, whose dispatched status is the documented exact-head verdict.
            if run_result and s["context"] != GUARD_CHECK and run_result[1] != "success":
                continue
            latest[s["context"]] = status
        pending = [n for n, (st, _) in latest.items() if st != "completed"]
        if not pending:
            failed = sorted(
                n for n, (_, c) in latest.items() if c not in ("success", "neutral", "skipped")
            )
            missing = sorted(r for r in required if latest.get(r, (None, None))[1] != "success")
            return failed, missing, latest
        if time.monotonic() > deadline:
            raise Blocked(f"CI still pending after {timeout_s}s: {', '.join(sorted(pending)[:5])}")
        time.sleep(poll_s)


def guard_missing(snap):
    """Run the base-blob lifecycle guard on the exact body; return its Missing items (None = pass)."""
    with tempfile.TemporaryDirectory() as d:
        for name, blob in (
            ("g.py", "tools/ui_surface_lifecycle_guard.py"),
            ("reg.yaml", "docs/architecture/convergence/REGISTRY.yaml"),
        ):
            with open(os.path.join(d, name), "w") as fh:
                fh.write(run(["git", "show", f"{snap['base']}:{blob}"]).stdout)
        with open(os.path.join(d, "body.md"), "w") as fh:
            fh.write(snap["body"])
        p = run(
            [
                sys.executable,
                "-I",
                f"{d}/g.py",
                "--base",
                snap["base"],
                "--head",
                snap["head"],
                "--pr-body-file",
                f"{d}/body.md",
                "--registry",
                f"{d}/reg.yaml",
            ],
            check=False,
        )
    if p.returncode == 0:
        return None
    m = re.search(r"Missing: (.*)", p.stdout + p.stderr)
    if not m:
        raise Blocked(f"lifecycle guard failed without a Missing list (rc={p.returncode})")
    return [x.strip() for x in m.group(1).split(",") if x.strip()]


def ledger(pr, snap, viewer):
    """Budget and exact-snapshot verdict from owner-authored comments only."""
    raw = gh("api", f"repos/{{owner}}/{{repo}}/issues/{pr}/comments", "--paginate")
    with tempfile.TemporaryDirectory() as d:
        comments, script = os.path.join(d, "comments.json"), os.path.join(d, "ledger.mjs")
        with open(comments, "w") as fh:
            fh.write(raw)
        with open(script, "w") as fh:
            fh.write(
                run(["git", "show", f"{snap['base']}:scripts/adversarial-review-ledger.mjs"]).stdout
            )
        led = json.loads(
            run(
                [
                    "node",
                    script,
                    comments,
                    viewer,
                    "--sha",
                    snap["head"],
                    "--body-sha256",
                    snap["body_sha256"],
                ]
            ).stdout
        )
    owned = [
        x
        for x in concat_json(raw)
        if (x.get("user") or {}).get("login") == viewer
        and (x.get("user") or {}).get("type") == "User"
        and isinstance(x.get("id"), int)
    ]
    verdict = followups = None
    for x in sorted(owned, key=lambda x: x["id"]):
        m = REVIEW_RE.match(x["body"])
        if m and m.group(1) == snap["head"] and m.group(2) == snap["body_sha256"]:
            verdict = {
                "status": m.group(3),
                "blocker": int(m.group(4)),
                "high": int(m.group(5)),
                "medium": int(m.group(6)),
                "comment_id": x["id"],
                "body": x["body"],
            }
            followups = None
        f = FOLLOWUPS_RE.match(x["body"])
        if f and verdict and f.group(1) == snap["head"] and f.group(2) == snap["body_sha256"]:
            followups = {"comment_id": x["id"], "issues": f.group(3).split()}
    if led.get("already") != 1 or led.get("prior_status") not in ("GREEN", "ISSUES_FOUND"):
        verdict = followups = None  # the ledger script is the authority on exact-snapshot status
    elif verdict is None or verdict["status"] != led["prior_status"]:
        raise Blocked("ledger script and review envelope disagree for this exact snapshot")
    return led["consumed"], verdict, followups


def decide(snap, ci, guard, review, budget_used, tier):
    """Pure gate decision. Returns (status, reasons, next_action); action None means final."""
    failed, missing, latest = ci
    reasons = []
    review_item_only = guard is not None and set(guard) == {GUARD_REVIEW_ITEM}
    if guard is not None and not review_item_only:
        return "BLOCKED", [f"lifecycle guard missing: {', '.join(guard)}"], None
    other = [n for n in failed if not (n == GUARD_CHECK and review_item_only)]
    if other:
        return "BLOCKED", [f"CI failed at {snap['head'][:12]}: {', '.join(other)}"], None
    if missing:
        return (
            "BLOCKED",
            [f"required check not green at {snap['head'][:12]}: {', '.join(missing)}"],
            None,
        )
    verdict, followups = review
    if verdict is None:
        if budget_used >= MAX_ROUNDS:
            return (
                "BLOCKED",
                [
                    f"Codex budget exhausted ({budget_used}/{MAX_ROUNDS}); "
                    "only a human-authorized review-only pass remains"
                ],
                None,
            )
        return "BLOCKED", ["no exact-head, exact-body Codex verdict yet"], "review"
    if verdict["blocker"] or verdict["high"]:
        return (
            "BLOCKED",
            [
                f"Codex found {verdict['blocker']} BLOCKER / {verdict['high']} HIGH at this "
                f"snapshot (comment {verdict['comment_id']}); fix and push a new head"
            ],
            "fix",
        )
    if verdict["status"] == "ISSUES_FOUND":
        if not followups or len(followups["issues"]) < verdict["medium"]:
            return (
                "BLOCKED",
                [f"CONVERGED with {verdict['medium']} MEDIUM; follow-ups not filed"],
                "followups",
            )
        reasons.append(f"CONVERGED; MEDIUMs accepted as follow-ups {' '.join(followups['issues'])}")
    if guard is not None and latest.get(GUARD_CHECK, (None, None))[1] != "success":
        return "BLOCKED", ["lifecycle guard has no success status at this exact head"], "guard"
    if tier[0] in ("needs_authorization", "human_safety"):
        who = (
            "a separate human safety authorization"
            if tier[0] == "human_safety"
            else "explicit owner approval"
        )
        return (
            "NEEDS_APPROVAL",
            reasons + [f"{tier[0]} paths need {who}: {', '.join(tier[1][:8])}"],
            None,
        )
    note = "activation stays separately gated" if tier[0] == "backend" else "low-risk paths"
    return (
        "GREEN",
        reasons + [f"all gates pass at exact head ({note}); merge remains the owner's"],
        None,
    )


def loop_supports_converged(base):
    text = run(["git", "show", f"{base}:scripts/adversarial-review-loop.sh"]).stdout
    return bool(re.search(r"^\s*exit 5\s*$", text, re.M)) and "CONVERGED" in text


def run_review(pr, snap, full):
    """One round through the trusted entrypoint loaded from the captured base object."""
    entry = run(["git", "show", f"{snap['base']}:scripts/adversarial-review-trusted.sh"]).stdout
    args = ["--max-iter", "1"] if full else ["--review-only"]
    p = run(["bash", "-s", "--", str(pr), *args], stdin=entry, check=False, timeout=5400)
    sys.stderr.write(p.stdout[-2000:] + p.stderr[-2000:])
    if p.returncode not in (0, 1, 5):
        raise Blocked(f"review tooling failed (rc={p.returncode}); not a verdict")


def file_followups(pr, snap, verdict):
    found = FINDING_RE.findall(verdict["body"])
    if len(found) != verdict["medium"]:
        raise Blocked(
            f"review lists {len(found)} MEDIUM headings for {verdict['medium']} MEDIUM; file by hand"
        )
    nums = []
    for fid, title in found:
        body = (
            f"Follow-up from the Codex review of PR #{pr} at {snap['head']} "
            f"(comment {verdict['comment_id']}), finding {fid}, MEDIUM. Accepted under the CONVERGED "
            "rule (docs/architecture/mira-sdlc-v1.md section 4.3); the finding text is in that comment."
        )
        url = gh(
            "issue", "create", "--title", f"{title[:200]} (#{pr} {fid})", "--body", body
        ).strip()
        nums.append("#" + url.rsplit("/", 1)[-1])
    gh(
        "pr",
        "comment",
        str(pr),
        "--body",
        "[REVIEW-FOLLOWUPS]\n\n```\n"
        f"reviewed_sha: {snap['head']}\n"
        f"reviewed_body_sha256: {snap['body_sha256']}\nissues: {' '.join(nums)}\n```\n",
    )
    return nums


def acquire_lock(pr):
    """One controller per PR on this machine; the review ledger arbitrates across machines."""
    common = run(["git", "rev-parse", "--git-common-dir"]).stdout.strip()
    path = os.path.join(os.path.abspath(common), f"pr-completion-{pr}.lock")
    try:
        os.mkdir(path)
    except FileExistsError:
        try:
            os.kill(int(open(os.path.join(path, "pid")).read()), 0)
            raise Blocked(f"another controller owns PR #{pr} ({path})")
        except (OSError, ValueError):
            raise Blocked(
                f"stale controller lock {path}; remove it by hand after checking"
            ) from None
    with open(os.path.join(path, "pid"), "w") as fh:
        fh.write(str(os.getpid()))
    return path


def report(result, out_dir):
    lines = [
        f"[PR-COMPLETION-STATUS] {result['status']}",
        "",
        "```",
        *(
            f"{k}: {result[k]}"
            for k in ("pr", "head", "base", "body_sha256", "tier", "codex_rounds_used")
        ),
        "```",
        "",
        *(f"- {r}" for r in result["reasons"]),
        *(f"- action: {a}" for a in result["actions"]),
        "",
        "Output only: this record is never read back as evidence.",
    ]
    text = "\n".join(lines) + "\n"
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, f"pr-{result['pr']}-{(result['head'] or 'none')[:12]}")
    json.dump(result, open(stem + ".json", "w"), indent=2)
    open(stem + ".md", "w").write(text)
    return text


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("pr", type=int)
    ap.add_argument(
        "--mode",
        choices=("review", "full"),
        default="review",
        help="full lets the trusted loop remediate BLOCKER/HIGH (needs base loop CONVERGED stop)",
    )
    ap.add_argument("--max-cycles", type=int, default=4)
    ap.add_argument(
        "--no-followups", action="store_true", help="report CONVERGED instead of filing issues"
    )
    ap.add_argument(
        "--allow-paid-push",
        action="store_true",
        help="permit full mode when a remediation push would fire a paid workflow",
    )
    ap.add_argument("--ci-timeout", type=int, default=3600)
    ap.add_argument("--poll", type=int, default=60)
    ap.add_argument("--read-only", action="store_true", help="evaluate and report; take no action")
    ap.add_argument("--post-status", action="store_true")
    ap.add_argument("--out", default=".pr-completion")
    a = ap.parse_args(argv)
    result = {
        "pr": a.pr,
        "head": None,
        "base": None,
        "body_sha256": None,
        "tier": None,
        "codex_rounds_used": None,
        "status": "BLOCKED",
        "reasons": [],
        "actions": [],
    }
    lock = None
    try:
        lock = acquire_lock(a.pr)
        viewer = json.loads(gh("api", "user"))["login"]
        expected = None
        for _ in range(max(1, a.max_cycles)):
            snap = snapshot(a.pr)
            if expected and snap["head"] != expected:
                raise Blocked(
                    f"head moved to {snap['head'][:12]} without this controller; competing writer"
                )
            prot = json.loads(
                gh("api", f"repos/{{owner}}/{{repo}}/branches/{snap['base_ref']}/protection")
            )
            required = (prot.get("required_status_checks") or {}).get("contexts") or []
            tier = risk_tier(snap["files"])
            result.update(
                head=snap["head"], base=snap["base"], body_sha256=snap["body_sha256"], tier=tier[0]
            )
            ci = ci_state(snap, required, a.ci_timeout, a.poll)
            guard = guard_missing(snap)
            used, verdict, followups = ledger(a.pr, snap, viewer)
            result["codex_rounds_used"] = used
            status, reasons, action = decide(snap, ci, guard, (verdict, followups), used, tier)
            result.update(status=status, reasons=reasons)
            expected = snap["head"]
            if action is None or a.read_only or (action == "fix" and a.mode != "full"):
                break
            if action == "followups" and a.no_followups:
                break
            result["actions"].append(f"{action} at {snap['head'][:12]}")
            if action == "review":
                full = a.mode == "full" and loop_supports_converged(snap["base"])
                if a.mode == "full" and not full:
                    result["actions"].append(
                        "full mode unavailable: base loop lacks the CONVERGED stop"
                    )
                paid = paid_paths(snap["base"], snap["files"])
                if full and paid and not a.allow_paid_push:
                    raise Blocked(
                        f"full mode would push into paid workflow paths: {', '.join(paid[:5])}"
                    )
                run_review(a.pr, snap, full)
                expected = None if full else snap["head"]
            elif action == "fix":
                raise Blocked(
                    "the verdict already exists for this snapshot; the trusted loop cannot "
                    "remediate a deduplicated verdict, so a human or Claude session must fix it"
                )
            elif action == "followups":
                result["actions"].append("filed " + " ".join(file_followups(a.pr, snap, verdict)))
                if guard is not None:
                    gh(
                        "workflow",
                        "run",
                        "ui-lifecycle-guard.yml",
                        "--ref",
                        "main",
                        "-f",
                        f"pr_number={a.pr}",
                    )
            elif action == "guard":
                gh(
                    "workflow",
                    "run",
                    "ui-lifecycle-guard.yml",
                    "--ref",
                    "main",
                    "-f",
                    f"pr_number={a.pr}",
                )
                time.sleep(a.poll)
        else:
            result["status"] = "BLOCKED"
            result["reasons"].append(f"cycle limit {a.max_cycles} reached before a final verdict")
        final = snapshot(a.pr)
        if (final["head"], final["body_sha256"]) != (result["head"], result["body_sha256"]):
            result.update(
                status="BLOCKED",
                reasons=["PR head or body changed after evaluation; evidence is stale"],
            )
    except Blocked as e:
        result.update(status="BLOCKED", reasons=result["reasons"] + [str(e)])
    finally:
        if lock:
            os.unlink(os.path.join(lock, "pid"))
            os.rmdir(lock)
    text = report(result, a.out)
    sys.stdout.write(text + "\n")
    if a.post_status and result["head"]:
        try:
            gh("pr", "comment", str(a.pr), "--body", text)
        except Blocked as e:
            sys.stderr.write(f"status comment not posted: {e}\n")
    return {"GREEN": 0, "NEEDS_APPROVAL": 3}.get(result["status"], 1)


if __name__ == "__main__":
    sys.exit(main())
