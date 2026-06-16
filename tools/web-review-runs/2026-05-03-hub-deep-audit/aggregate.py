#!/usr/bin/env python3
"""Aggregate per-route crawl findings + audit.py outputs into a single
Findings list, dedup, rank, and emit findings.aggregated.json + findings.table.md.

Inputs:
- mira-hub/test-results/audit-2026-05-03/findings/*.json  (one per route×viewport)
- raw/lh-findings.json, raw/headers.json, raw/edges.json   (audit.py outputs)

Outputs:
- findings.aggregated.json
- findings.table.md          (markdown table for human review)

Dedup:
- Within run: same fingerprint → merge, increment occurrences, keep first 3 evidences.
- Against existing GitHub issues: `gh issue list --search "[web-review] <fp>" --state all`.
  Annotated as `existing_gh: <number>` on the finding so the human + filer skip it.
- Against existing Linear issues: read raw/linear-known.json (a JSON list of {id, title})
  written by the orchestrator before this script runs. Annotated as `existing_linear: CRA-N`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[3]
FINDINGS_DIR = REPO_ROOT / "mira-hub" / "test-results" / "audit-2026-05-03" / "findings"
RAW_DIR = Path(__file__).parent / "raw"
OUT_DIR = Path(__file__).parent

SEVERITY_RANK = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


def fingerprint(severity: str, page: str, check_id: str) -> str:
    norm = re.sub(r"/\d+", "/N", page or "/")
    return f"{severity}:{norm}:{check_id}"


def finding(severity: str, page: str, check_id: str, title: str, evidence: str,
            suggested_fix: str = "", source: str = "", viewport: str = "") -> dict:
    return {
        "id": fingerprint(severity, page, check_id),
        "severity": severity,
        "page": page,
        "title": title,
        "evidence": evidence,
        "suggested_fix": suggested_fix,
        "occurrences": 1,
        "source": source,
        "viewport": viewport,
    }


def slug_text_for_id(text: str) -> str:
    return hashlib.md5(text.lower().strip().encode("utf-8", errors="replace")).hexdigest()[:8]


# ---------- Per-route → Findings ----------

def map_route_payload(route_findings: dict) -> list[dict]:
    """Walk one per-route findings.json → multiple Findings.

    Consolidation rules:
    - If load_status >= 400, the page never rendered. Skip DOM-derived findings
      (no-H1, no-title, etc.) — they're all symptoms of the page not existing.
    - Console "Failed to load resource: status of N" lines mirror network N findings.
      Suppress the console copy if a matching network finding exists.
    """
    out: list[dict] = []
    page = route_findings.get("route") or "/"
    viewport = "mobile" if route_findings.get("viewport", {}).get("width", 999) < 500 else "desktop"
    load_failed = (route_findings.get("load_status") or 0) >= 400

    # Build the set of network error statuses for this route — used to suppress
    # console mirrors of the same failures.
    net_statuses = {ne.get("status") for ne in (route_findings.get("network_errors") or [])}

    # 1) DOM-eval payload — skip entirely if page didn't render
    if not load_failed:
        dom = route_findings.get("dom") or {}
        out += dom_findings(dom, viewport)

    # 2) Console errors / page errors / warnings
    for entry in route_findings.get("console") or []:
        text = entry.get("text", "")
        location = entry.get("location") or ""
        # Suppress preload-not-used warnings (Lighthouse covers them)
        if "preloaded using link preload but not used" in text:
            continue
        if entry.get("type") == "pageerror":
            out.append(finding(
                "P0", page, f"pageerror-{slug_text_for_id(text)}",
                f"Uncaught JS exception: {text[:60]}",
                f"{text[:200]} @ {location}",
                "Fix the exception or wrap in try/catch", "console", viewport,
            ))
        elif entry.get("type") == "error":
            # Suppress generic "Failed to load resource: status of N" — they
            # mirror our network_errors entries with more detail.
            if "Failed to load resource" in text:
                m = re.search(r"status of (\d+)", text)
                if m and int(m.group(1)) in net_statuses:
                    continue
            sev = "P1"
            out.append(finding(
                sev, page, f"console-error-{slug_text_for_id(text)}",
                f"Console error: {text[:60]}",
                f"{text[:200]} @ {location}",
                "", "console", viewport,
            ))
        # warnings → P3 only if not the preload noise
        elif entry.get("type") == "warning":
            out.append(finding(
                "P3", page, f"console-warn-{slug_text_for_id(text)}",
                f"Console warning: {text[:60]}",
                f"{text[:200]} @ {location}",
                "", "console", viewport,
            ))

    # 3) Network 4xx/5xx
    for ne in route_findings.get("network_errors") or []:
        url = ne.get("url", "")
        status = ne.get("status", 0)
        normalized_path = urlparse(url).path or "/"
        if status >= 500:
            sev = "P0"
        elif status == 404:
            sev = "P1"
        elif status in (401, 403):
            sev = "P1"
        else:
            sev = "P2"
        out.append(finding(
            sev, page, f"net-{status}-{slug_text_for_id(normalized_path)}",
            f"{status} on {normalized_path}",
            f"{ne.get('method', '?')} {url} ({ne.get('resource_type', '?')})",
            "Either remove the dead request or fix the endpoint", "network", viewport,
        ))

    # 4) Click errors (timeouts = dead UI)
    click_timeouts = [c for c in (route_findings.get("clicks") or [])
                      if c.get("result") == "error" and "timeout" in (c.get("error") or "").lower()]
    if click_timeouts:
        # Group all timeouts on one route into one finding to avoid spam
        examples = "; ".join(f"'{c.get('text', '')[:30]}'" for c in click_timeouts[:5])
        out.append(finding(
            "P2", page, "click-timeouts",
            f"{len(click_timeouts)} clickable(s) did not respond within 2s",
            f"Examples: {examples}",
            "Either add a click handler or remove the button — silent UI is a usability bug",
            "click", viewport,
        ))

    # 5) Load errors / non-2xx page load
    if route_findings.get("error"):
        out.append(finding(
            "P0", page, "page-load-failed",
            f"Page failed to load: {route_findings['error'][:60]}",
            route_findings["error"][:200],
            "Investigate the route", "navigation", viewport,
        ))
    load_status = route_findings.get("load_status")
    if load_status and load_status >= 400:
        out.append(finding(
            "P0" if load_status >= 500 else "P1",
            page, f"page-load-{load_status}",
            f"Initial page load returned {load_status}",
            f"GET {page} → {load_status}",
            "Fix the route handler", "navigation", viewport,
        ))

    return out


def dom_findings(dom: dict, viewport: str) -> list[dict]:
    """Inlined version of .claude/skills/web-review/scripts/audit.py:map_dom."""
    out: list[dict] = []
    page = urlparse(dom.get("url", "")).path or "/"
    if dom.get("h1_count", 0) == 0:
        out.append(finding("P1", page, "no-h1", "Page has no H1",
                           "DOM scan: 0 <h1> elements", "", "dom", viewport))
    elif dom.get("h1_count", 0) > 1:
        out.append(finding("P2", page, "multiple-h1",
                           f"Page has {dom['h1_count']} H1s",
                           "DOM scan: more than one <h1>", "", "dom", viewport))
    if dom.get("heading_skips"):
        out.append(finding("P2", page, "heading-skips",
                           "Heading levels skipped", ", ".join(dom["heading_skips"]),
                           "", "dom", viewport))
    no_alt = dom.get("images_no_alt") or []
    if no_alt:
        out.append(finding("P2", page, "images-no-alt",
                           f"{len(no_alt)} image(s) missing alt",
                           ", ".join(no_alt[:3]) + (" …" if len(no_alt) > 3 else ""),
                           "", "dom", viewport))
    meta = dom.get("meta") or {}
    if not meta.get("title"):
        out.append(finding("P1", page, "no-title", "Missing <title>", "head: no <title>",
                           "", "dom", viewport))
    if not meta.get("description"):
        out.append(finding("P2", page, "no-meta-description",
                           "Missing meta description",
                           "head: no <meta name='description'>", "", "dom", viewport))
    if not meta.get("viewport"):
        out.append(finding("P1", page, "no-viewport",
                           "Missing viewport meta",
                           "head: no <meta name='viewport'>", "", "dom", viewport))
    if not meta.get("canonical"):
        out.append(finding("P2", page, "no-canonical",
                           "Missing canonical link",
                           "head: no <link rel='canonical'>", "", "dom", viewport))
    if not meta.get("og_title") or not meta.get("og_image") or not meta.get("og_url"):
        missing = [k for k in ("og_title", "og_image", "og_url") if not meta.get(k)]
        out.append(finding("P2", page, "incomplete-og",
                           "Incomplete Open Graph tags",
                           f"missing: {', '.join(missing)}", "", "dom", viewport))
    if not meta.get("twitter_card"):
        out.append(finding("P3", page, "no-twitter-card",
                           "Missing twitter:card",
                           "head: no <meta name='twitter:card'>", "", "dom", viewport))
    if not meta.get("lang"):
        out.append(finding("P1", page, "no-html-lang",
                           "Missing <html lang> attribute",
                           "html: no lang attribute", "", "dom", viewport))
    for dep in dom.get("deprecated_meta") or []:
        out.append(finding("P2", page, f"deprecated-meta-{dep}",
                           f"Deprecated meta tag: {dep}",
                           f"<meta name='{dep}'> without modern companion", "", "dom", viewport))
    if dom.get("external_no_noopener"):
        cnt = len(dom["external_no_noopener"])
        out.append(finding("P3", page, "noopener-missing",
                           f"{cnt} target='_blank' link(s) without rel='noopener'",
                           dom["external_no_noopener"][0][:100], "", "dom", viewport))
    if dom.get("mixed_content"):
        out.append(finding("P0", page, "mixed-content",
                           f"{len(dom['mixed_content'])} resource(s) loaded over HTTP on HTTPS page",
                           dom["mixed_content"][0][:120], "", "dom", viewport))
    tap = dom.get("tap_targets_too_small") or []
    if tap and viewport == "mobile":  # only flag on mobile viewport
        out.append(finding("P2", page, "tap-targets-small",
                           f"{len(tap)} tap target(s) < 44px (mobile)",
                           "; ".join(f"{t['tag']} '{t['text'][:20]}' {t['w']}×{t['h']}" for t in tap[:3]),
                           "", "dom", viewport))
    if dom.get("buttons_no_name", 0) > 0:
        out.append(finding("P1", page, "buttons-no-name",
                           f"{dom['buttons_no_name']} button(s) without accessible name",
                           "DOM: <button> with no text, aria-label, or title", "", "dom", viewport))
    for form in dom.get("forms") or []:
        if form.get("inputs_unlabelled", 0) > 0:
            out.append(finding("P1", page, "form-inputs-unlabelled",
                               f"{form['inputs_unlabelled']} unlabelled input(s)",
                               f"form action={form.get('action')}", "", "dom", viewport))
    return out


# ---------- Dedup ----------

def merge_within_run(findings: list[dict]) -> list[dict]:
    """Group by id, sum occurrences, keep first 3 evidences as a list."""
    by_id: dict[str, dict] = {}
    for f in findings:
        fid = f["id"]
        if fid in by_id:
            existing = by_id[fid]
            existing["occurrences"] += 1
            evidences = existing.setdefault("evidences", [existing["evidence"]])
            if len(evidences) < 3 and f["evidence"] not in evidences:
                evidences.append(f["evidence"])
            existing["evidence"] = "; ".join(evidences)
            v_existing = existing.get("viewport", "")
            v_new = f.get("viewport", "")
            if v_existing and v_new and v_existing != v_new:
                existing["viewport"] = "both"
        else:
            by_id[fid] = dict(f)
    return list(by_id.values())


def collapse_sitewide(findings: list[dict], route_threshold: int = 3) -> list[dict]:
    """If a check_id (stripped of route) appears on > N routes, collapse to one
    site-wide finding with `page='(site-wide)'` and `affected_routes` populated.
    This prevents spam like '[hubDataProvider] env unset' showing 25× — once per route."""
    # Extract check_id (everything after the second colon in fingerprint)
    by_check: dict[tuple[str, str], list[dict]] = {}
    for f in findings:
        parts = f["id"].split(":", 2)
        if len(parts) < 3:
            continue
        sev, _route, check_id = parts
        by_check.setdefault((sev, check_id), []).append(f)

    out: list[dict] = []
    seen_collapsed: set[tuple[str, str]] = set()
    for f in findings:
        parts = f["id"].split(":", 2)
        if len(parts) < 3:
            out.append(f)
            continue
        sev, _route, check_id = parts
        key = (sev, check_id)
        siblings = by_check[key]
        if len(siblings) > route_threshold:
            if key in seen_collapsed:
                continue
            seen_collapsed.add(key)
            routes = sorted({s["page"] for s in siblings})
            collapsed = dict(siblings[0])
            collapsed["id"] = fingerprint(sev, "(site-wide)", check_id)
            collapsed["page"] = "(site-wide)"
            collapsed["occurrences"] = sum(s.get("occurrences", 1) for s in siblings)
            collapsed["affected_routes"] = routes
            collapsed["evidence"] = (
                f"Seen on {len(routes)} routes: {', '.join(routes[:5])}"
                + (" …" if len(routes) > 5 else "")
                + f". Example: {siblings[0]['evidence'][:140]}"
            )
            out.append(collapsed)
        else:
            out.append(f)
    return out


def dedup_against_github(findings: list[dict], repo: str = "Mikecranesync/MIRA") -> list[dict]:
    """Annotate findings with `existing_gh: N` if a matching GitHub issue exists."""
    for f in findings:
        try:
            r = subprocess.run(
                ["gh", "issue", "list", "--repo", repo,
                 "--search", f'[web-review] {f["id"]}', "--state", "all",
                 "--json", "number,title", "--limit", "5"],
                capture_output=True, text=True, timeout=20,
            )
            if r.returncode == 0:
                existing = json.loads(r.stdout or "[]")
                if existing:
                    f["existing_gh"] = existing[0]["number"]
                    f["existing_gh_title"] = existing[0]["title"]
        except Exception as e:
            f["dedup_gh_error"] = str(e)[:120]
    return findings


def dedup_against_linear(findings: list[dict], known_path: Path) -> list[dict]:
    """Annotate findings with `existing_linear: CRA-N` if matched in known_path JSON."""
    if not known_path.exists():
        return findings
    known = json.loads(known_path.read_text(encoding="utf-8"))
    # `known` is a list of {id, identifier, title} from mcp__linear__list_issues
    for f in findings:
        for issue in known:
            title = (issue.get("title") or "")
            if f["id"] in title or (
                f["title"] in title and f["page"] in title
            ):
                f["existing_linear"] = issue.get("identifier") or issue.get("id")
                f["existing_linear_title"] = title
                break
    return findings


# ---------- Output ----------

def render_table(findings: list[dict]) -> str:
    lines = [
        "| #  | Sev | Route                  | Title                                                | Evidence (one line)                              | Dup? |",
        "|----|-----|------------------------|------------------------------------------------------|--------------------------------------------------|------|",
    ]
    for i, f in enumerate(findings, start=1):
        sev_emoji = {"P0": "🔴", "P1": "🟠", "P2": "🟡", "P3": "🟢"}.get(f["severity"], "  ")
        dup = ""
        if f.get("existing_gh"):
            dup += f"GH#{f['existing_gh']}"
        if f.get("existing_linear"):
            dup += f" {f['existing_linear']}" if dup else f["existing_linear"]
        page = (f["page"] or "/")[:22]
        title = f["title"][:52]
        ev = (f["evidence"] or "")[:48].replace("\n", " ").replace("|", "/")
        lines.append(f"| {i:>2} | {sev_emoji}  | {page:<22} | {title:<52} | {ev:<48} | {dup or '—':<4} |")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-gh-dedup", action="store_true",
                        help="Skip the gh issue search dedup pass (faster, used in dry runs)")
    args = parser.parse_args()

    all_findings: list[dict] = []

    # 1) Per-route findings
    if FINDINGS_DIR.exists():
        for jf in sorted(FINDINGS_DIR.glob("*.json")):
            try:
                data = json.loads(jf.read_text(encoding="utf-8"))
                all_findings.extend(map_route_payload(data))
            except Exception as e:
                print(f"WARN: failed to read {jf}: {e}", file=sys.stderr)

    # 2) Lighthouse / headers / edges + any preserved aggregated runs (e.g.,
    # desktop-findings.aggregated.json from a previous run that got wiped).
    for raw in ("lh-findings.json", "headers.json", "edges.json",
                "desktop-findings.aggregated.json"):
        p = RAW_DIR / raw
        if p.exists() and p.stat().st_size > 0:
            try:
                all_findings.extend(json.loads(p.read_text(encoding="utf-8")))
            except Exception as e:
                print(f"WARN: failed to read {p}: {e}", file=sys.stderr)

    print(f"raw findings: {len(all_findings)}", file=sys.stderr)

    # 2.5) Post-filter known mirrors / test artifacts
    def keep(f: dict) -> bool:
        title = f.get("title", "") or ""
        # "Console error: Failed to load resource..." always mirrors a network finding
        # we already capture separately.
        if title.startswith("Console error: Failed to load resource"):
            return False
        # Test artifact: drill closes a navigated page, screenshot then errors —
        # not a real bug.
        if title.startswith("Page failed to load: page.screenshot"):
            return False
        return True

    pre_filter = len(all_findings)
    all_findings = [f for f in all_findings if keep(f)]
    print(f"after artifact filter: {len(all_findings)} (-{pre_filter - len(all_findings)})", file=sys.stderr)

    # 2.6) Suppress cascading DOM symptoms for routes that 404'd on initial load.
    # If "Initial page load returned 4xx" exists for a route, the page never
    # rendered — no-h1/no-title/missing-viewport are downstream of the 404,
    # not separate bugs.
    pages_404 = {f["page"] for f in all_findings
                 if "Initial page load returned" in (f.get("title") or "")}
    DEPENDENT_TITLES = (
        "Page has no H1", "Missing <title>", "Missing viewport meta",
        "Missing <html lang>", "Missing meta description",
        "Missing canonical link", "Incomplete Open Graph tags",
        "Heading levels skipped",
    )

    def keep_after_cascade(f: dict) -> bool:
        if f.get("page") in pages_404 and any(
            (f.get("title") or "").startswith(t) for t in DEPENDENT_TITLES
        ):
            return False
        return True

    pre_cascade = len(all_findings)
    all_findings = [f for f in all_findings if keep_after_cascade(f)]
    print(f"after cascade suppress: {len(all_findings)} (-{pre_cascade - len(all_findings)}) [pages 404'd: {sorted(pages_404)}]",
          file=sys.stderr)

    # 2.7) For routes with "Initial page load returned 4xx", suppress the matching
    # network finding that's the SAME request from a different angle.
    def keep_no_net_dup(f: dict) -> bool:
        page = f.get("page", "")
        title = f.get("title", "") or ""
        # Match net findings where url path equals the route itself
        if page in pages_404 and title.startswith(f"404 on {page}"):
            return False
        return True

    pre_netdup = len(all_findings)
    all_findings = [f for f in all_findings if keep_no_net_dup(f)]
    print(f"after net-dup suppress: {len(all_findings)} (-{pre_netdup - len(all_findings)})", file=sys.stderr)

    # 3) Dedup within run
    merged = merge_within_run(all_findings)
    print(f"after within-run dedup: {len(merged)}", file=sys.stderr)

    # 3b) Collapse site-wide findings (same check_id on >3 routes → one issue)
    merged = collapse_sitewide(merged)
    print(f"after site-wide collapse:  {len(merged)}", file=sys.stderr)

    # 4) Dedup against existing GH
    if not args.skip_gh_dedup:
        merged = dedup_against_github(merged)
        gh_dups = sum(1 for f in merged if f.get("existing_gh"))
        print(f"matched existing GH issues: {gh_dups}", file=sys.stderr)

    # 5) Dedup against Linear (if list available)
    linear_known = OUT_DIR / "raw" / "linear-known.json"
    merged = dedup_against_linear(merged, linear_known)
    li_dups = sum(1 for f in merged if f.get("existing_linear"))
    print(f"matched existing Linear issues: {li_dups}", file=sys.stderr)

    # 6) Sort: severity, route depth, occurrences desc
    merged.sort(key=lambda f: (
        SEVERITY_RANK.get(f["severity"], 9),
        (f["page"] or "/").count("/"),
        -f.get("occurrences", 1),
    ))

    # 7) Write outputs
    (OUT_DIR / "findings.aggregated.json").write_text(json.dumps(merged, indent=2), encoding="utf-8")
    (OUT_DIR / "findings.table.md").write_text(render_table(merged) + "\n", encoding="utf-8")

    # Summary to stdout
    by_sev = {}
    for f in merged:
        by_sev[f["severity"]] = by_sev.get(f["severity"], 0) + 1
    print(f"\nFinal aggregated findings: {len(merged)}")
    for sev in ("P0", "P1", "P2", "P3"):
        if sev in by_sev:
            print(f"  {sev}: {by_sev[sev]}")
    print(f"\nWrote {OUT_DIR/'findings.aggregated.json'}")
    print(f"Wrote {OUT_DIR/'findings.table.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
