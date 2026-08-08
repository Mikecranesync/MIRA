"""File GitHub issues for open campaign findings — deduplicated, dry-run first.

One issue per DEFECT, not per conversation, so a finding seen in four rounds
does not become four issues. Dedupe is by an HTML-comment marker carrying the
fingerprint, which survives title edits and relabelling; matching on the title
would re-file the moment somebody rewords it.

Filing is opt-in. The default prints exactly what WOULD be filed, because a
noisy campaign round can carry a dozen findings and nobody wants that arriving
unannounced. Once filed, the issue number is written back into dispositions.yml
so the next report renders it and the next run skips it.

  py -3 -m tests.regime1_telethon.campaign.issues --campaign c1          # dry run
  py -3 -m tests.regime1_telethon.campaign.issues --campaign c1 --file   # for real
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))  # repo root

from tests.regime1_telethon.campaign import findings  # noqa: E402
from tests.regime1_telethon.campaign import report as report_mod  # noqa: E402

REPO = "Mikecranesync/MIRA"
MARKER = "campaign-finding"
LABELS = ["needs-triage"]


def marker(fp: str) -> str:
    """Hidden, stable dedupe key embedded in the issue body."""
    return f"<!-- {MARKER}: {fp} -->"


def existing_issues() -> dict[str, str]:
    """Map fingerprint -> issue number for every OPEN issue we already filed."""
    # encoding= is not optional: issue bodies contain em-dashes and box drawing,
    # and Python's default cp1252 on Windows raises UnicodeDecodeError reading
    # them. Failing to read the list must never degrade into "file anyway" —
    # that is how you get four issues for one defect.
    try:
        out = subprocess.run(
            [
                "gh",
                "issue",
                "list",
                "--repo",
                REPO,
                "--state",
                "open",
                "--limit",
                "300",
                "--json",
                "number,body",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=120,
            encoding="utf-8",
            errors="replace",
        ).stdout
    except (subprocess.SubprocessError, OSError, UnicodeDecodeError, ValueError) as exc:
        raise SystemExit(
            f"could not list issues ({exc}) — refusing to file blind and risk duplicates"
        )
    found: dict[str, str] = {}
    for issue in json.loads(out or "[]"):
        body = issue.get("body") or ""
        token = f"<!-- {MARKER}: "
        if token in body:
            fp = body.split(token, 1)[1].split(" -->", 1)[0].strip()
            found.setdefault(fp, str(issue["number"]))
    return found


def build_body(fp: str, d: findings.Disposition, campaign: str, verdicts: list[dict]) -> str:
    # FAILING rows only. A fingerprint covers a scenario family, and the mutator
    # emits several language variants of it — some of which pass. Citing a PASS
    # as evidence of a defect (and linking its transcript as the replay) makes
    # the issue read as noise and sends the reader to the wrong file.
    rows = [
        v
        for v in verdicts
        if findings.fingerprint(v["conv"], v.get("tier")) == fp
        and v.get("verdict") != report_mod.PASSING
    ]
    sha = next((v.get("deploy_sha") for v in rows if v.get("deploy_sha")), "not recorded")
    tier = rows[0].get("tier") if rows else "?"

    lines = [
        f"Found by the Telethon UAT campaign (`{campaign}`, tier {tier}) against staging.",
        "",
        f"**Finding:** `{fp}`  ",
        f"**Build:** {sha}  ",
        f"**Seen in:** {', '.join(sorted(set(d.convs))) or 'this run'}",
        "",
    ]
    if d.summary:
        lines += ["## What goes wrong", "", d.summary, ""]

    lines += ["## Evidence", ""]
    for v in rows:
        note = (v.get("notes") or "").strip()
        lines.append(f"- `{v['conv']}` — {v.get('verdict')} / {v.get('category') or 'UNTRIAGED'}")
        if note:
            lines.append(f"  - judge: {note}")
        ev = report_mod._evidence(campaign, v["conv"])
        if ev:
            lines.append(f"  - bot said: `{' '.join(ev.split())}`")
    lines.append("")

    lines += [
        "## Replay",
        "",
        "The full transcript is frozen in the campaign run:",
        "",
        "```",
        f"tests/regime1_telethon/campaign/frozen/{campaign}_{rows[0]['conv'] if rows else fp}.json",
        "```",
        "",
        "Re-run just this tier against staging:",
        "",
        "```bash",
        "doppler run -p factorylm -c stg -- py -3 -m tests.regime1_telethon.campaign.runner \\",
        f"    --campaign {campaign} --tier {tier} --count 20 --seed 42 --deploy-sha <sha>",
        "```",
        "",
        "---",
        "",
        "Filed automatically by the campaign loop. The disposition of record lives in",
        "`tests/regime1_telethon/campaign/dispositions.yml` — close this by setting that",
        "finding to `FIXED` (with the PR) or `FALSE_POSITIVE` (with the reason).",
        "",
        marker(fp),
    ]
    return "\n".join(lines)


def title_for(fp: str, d: findings.Disposition) -> str:
    summary = d.summary or "campaign finding needs triage"
    summary = summary.strip().rstrip(".")
    if len(summary) > 80:
        summary = summary[:77].rstrip() + "..."
    return f"UAT campaign: {summary} ({fp})"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--file", action="store_true", help="actually create issues (default: dry run)")
    ap.add_argument("--limit", type=int, default=10, help="max issues to file in one go")
    args = ap.parse_args()

    verdicts = report_mod.load_verdicts(args.campaign)
    disp = findings.load()
    already = existing_issues()

    # Anything failing this run that is still OPEN and has no issue recorded.
    candidates: list[str] = []
    for v in verdicts:
        if v.get("verdict") == report_mod.PASSING:
            continue
        fp = findings.fingerprint(v["conv"], v.get("tier"))
        d = disp.get(fp)
        if d is None:
            d = findings.observe(
                disp,
                v["conv"],
                v.get("tier"),
                args.campaign,
                summary=findings.summarize_verdict(v),
            )
        if d.status != findings.OPEN:
            continue
        if d.issue:
            continue
        if fp in already:
            d.issue = already[fp]  # filed by an earlier run; adopt the number
            continue
        if fp not in candidates:
            candidates.append(fp)

    if not candidates:
        findings.save(disp)
        print("nothing to file — every open finding already has an issue")
        return 0

    print(f"{len(candidates)} finding(s) without an issue:\n")
    filed = 0
    for fp in candidates[: args.limit]:
        d = disp[fp]
        title = title_for(fp, d)
        body = build_body(fp, d, args.campaign, verdicts)
        if not args.file:
            print(f"  WOULD FILE: {title}")
            continue
        try:
            out = subprocess.run(
                [
                    "gh",
                    "issue",
                    "create",
                    "--repo",
                    REPO,
                    "--title",
                    title,
                    "--body",
                    body,
                    *sum((["--label", lb] for lb in LABELS), []),
                ],
                capture_output=True,
                text=True,
                check=True,
                timeout=120,
                encoding="utf-8",
                errors="replace",
            ).stdout.strip()
        except (subprocess.SubprocessError, OSError, UnicodeDecodeError) as exc:
            print(f"  FAILED  {fp}: {exc}")
            continue
        num = out.rstrip("/").rsplit("/", 1)[-1]
        d.issue = num
        filed += 1
        print(f"  FILED #{num}: {title}")

    dropped = len(candidates) - min(len(candidates), args.limit)
    if dropped:
        print(f"\n{dropped} finding(s) NOT filed — over --limit {args.limit}. Re-run to continue.")

    findings.save(disp)
    if not args.file:
        print("\nDry run. Pass --file to create these.")
    else:
        print(f"\nfiled {filed}; dispositions.yml updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
