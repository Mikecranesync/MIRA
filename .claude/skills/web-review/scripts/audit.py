#!/usr/bin/env python3
"""web-review audit helpers — Lighthouse, security headers, edge probes, DOM-eval mapper.

Each subcommand reads inputs and emits a JSON list of Finding dicts to stdout.

A Finding:
{
  "id":           "<stable-fingerprint>",
  "severity":    "P0" | "P1" | "P2" | "P3",
  "page":        "/path",
  "title":       "Short human title",
  "evidence":    "One-line repro signal",
  "suggested_fix": "Optional pointer",
  "occurrences": 1,
  "source":      "lighthouse|headers|edges|dom|console|network",
}
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


def fingerprint(severity: str, path: str, check_id: str) -> str:
    norm = re.sub(r"/\d+", "/N", path or "/")
    return f"{severity}:{norm}:{check_id}"


def finding(severity: str, page: str, check_id: str, title: str, evidence: str,
            suggested_fix: str = "", source: str = "") -> dict:
    return {
        "id": fingerprint(severity, page, check_id),
        "severity": severity,
        "page": page,
        "title": title,
        "evidence": evidence,
        "suggested_fix": suggested_fix,
        "occurrences": 1,
        "source": source,
    }


# ---------- Lighthouse ----------

LIGHTHOUSE_THRESHOLDS = {
    "performance": (50, 80),       # <50 → P1, 50-80 → P2, ≥80 → ok
    "accessibility": (70, 90),
    "seo": (70, 90),
    "best-practices": (70, 90),
}


def parse_lighthouse(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    findings: list[dict] = []
    page = urlparse(data.get("requestedUrl", "")).path or "/"
    cats = data.get("categories", {})
    for key, cat in cats.items():
        score = (cat.get("score") or 0) * 100
        p1, p2 = LIGHTHOUSE_THRESHOLDS.get(key, (50, 80))
        if score < p1:
            sev = "P1"
        elif score < p2:
            sev = "P2"
        else:
            continue
        findings.append(finding(
            sev, page, f"lighthouse-{key}",
            f"Lighthouse {key} score {int(score)}",
            f"Threshold for {key} is ≥{p2}; got {int(score)}",
            f"Inspect Lighthouse report; common fixes: image optimization, JS deferral, semantic HTML",
            "lighthouse",
        ))
    audits = data.get("audits", {})
    high_impact = [
        ("color-contrast", "P2"),
        ("image-alt", "P2"),
        ("html-has-lang", "P1"),
        ("document-title", "P1"),
        ("meta-viewport", "P1"),
        ("uses-https", "P0"),
    ]
    for audit_id, sev in high_impact:
        a = audits.get(audit_id)
        if a and a.get("score") is not None and a["score"] < 1:
            findings.append(finding(
                sev, page, f"lighthouse-audit-{audit_id}",
                f"Lighthouse audit failed: {a.get('title', audit_id)}",
                a.get("description", "")[:200],
                "",
                "lighthouse",
            ))
    return findings


# ---------- Security headers ----------

REQUIRED_HEADERS = {
    "strict-transport-security": ("P0", "Missing HSTS over HTTPS"),
    "content-security-policy": ("P1", "Missing Content-Security-Policy"),
    "x-content-type-options": ("P2", "Missing X-Content-Type-Options: nosniff"),
    "x-frame-options": ("P2", "Missing X-Frame-Options (or frame-ancestors in CSP)"),
    "referrer-policy": ("P3", "Missing Referrer-Policy"),
    "permissions-policy": ("P3", "Missing Permissions-Policy"),
}


def check_headers(origin: str) -> list[dict]:
    findings: list[dict] = []
    parsed = urlparse(origin)
    is_https = parsed.scheme == "https"
    try:
        result = subprocess.run(
            ["curl", "-sI", "-L", "--max-time", "15", origin],
            capture_output=True, text=True, timeout=20,
        )
    except subprocess.TimeoutExpired:
        return [finding("P0", "/", "headers-timeout",
                       f"Origin {origin} did not respond in 15s",
                       "curl -sI timed out", "Check site availability", "headers")]
    headers_lc = {}
    for line in result.stdout.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            headers_lc[k.strip().lower()] = v.strip()
    for header, (sev, title) in REQUIRED_HEADERS.items():
        if header == "strict-transport-security" and not is_https:
            continue
        if header not in headers_lc:
            findings.append(finding(
                sev, "/", f"missing-header-{header}",
                title,
                f"curl -I {origin} returned headers without `{header}`",
                f"Add `{header}` header at the edge (nginx/CDN/Vercel config)",
                "headers",
            ))
    set_cookies = [v for k, v in headers_lc.items() if k == "set-cookie"] or \
                  re.findall(r"^set-cookie:\s*(.+)$", result.stdout, re.IGNORECASE | re.MULTILINE)
    for cookie in set_cookies:
        if is_https and "secure" not in cookie.lower():
            findings.append(finding(
                "P1", "/", "cookie-no-secure",
                "Cookie set without Secure flag over HTTPS",
                cookie[:120],
                "Add Secure attribute to cookie",
                "headers",
            ))
        if "httponly" not in cookie.lower() and "session" in cookie.lower():
            findings.append(finding(
                "P2", "/", "cookie-no-httponly",
                "Session-like cookie without HttpOnly",
                cookie[:120],
                "Add HttpOnly attribute",
                "headers",
            ))
    if is_https:
        host = parsed.hostname
        try:
            cert = subprocess.run(
                f'echo | openssl s_client -connect {host}:443 -servername {host} 2>/dev/null '
                f'| openssl x509 -noout -enddate',
                shell=True, capture_output=True, text=True, timeout=10,
            )
            m = re.search(r"notAfter=(.+)", cert.stdout)
            if m:
                expiry = datetime.strptime(m.group(1).strip(), "%b %d %H:%M:%S %Y %Z")
                days_left = (expiry.replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).days
                if days_left < 7:
                    findings.append(finding(
                        "P0", "/", "tls-expiring-7d",
                        f"TLS cert expires in {days_left} day(s)",
                        f"notAfter: {m.group(1).strip()}",
                        "Renew certificate immediately",
                        "headers",
                    ))
                elif days_left < 30:
                    findings.append(finding(
                        "P2", "/", "tls-expiring-30d",
                        f"TLS cert expires in {days_left} days",
                        f"notAfter: {m.group(1).strip()}",
                        "Schedule renewal",
                        "headers",
                    ))
        except Exception:
            pass
    return findings


# ---------- Edge probes ----------

def check_edges(origin: str) -> list[dict]:
    findings: list[dict] = []
    rand = f"/__webreview_404_{int(datetime.now(timezone.utc).timestamp())}"
    r = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", origin + rand],
        capture_output=True, text=True, timeout=15,
    )
    if r.stdout.strip() != "404":
        findings.append(finding(
            "P2", rand, "404-wrong-status",
            f"Random nonexistent path returned {r.stdout.strip()} instead of 404",
            f"GET {origin}{rand}",
            "Configure server to return 404 for unknown routes",
            "edges",
        ))
    body = subprocess.run(
        ["curl", "-s", "-L", "--max-time", "10", origin + rand],
        capture_output=True, text=True, timeout=15,
    ).stdout
    if not re.search(r"404|not found", body, re.IGNORECASE):
        findings.append(finding(
            "P2", rand, "404-no-message",
            "404 page does not display 'not found' or status",
            body[:120],
            "Add user-friendly 404 page with link back home",
            "edges",
        ))
    if not re.search(r"href=[\"'][/.]?[\"' ]|href=[\"']/[\"']", body):
        findings.append(finding(
            "P3", rand, "404-no-home-link",
            "404 page has no home link",
            "No href='/'-shaped link in body",
            "Add 'Back to home' link",
            "edges",
        ))
    robots = subprocess.run(
        ["curl", "-s", "--max-time", "10", origin + "/robots.txt"],
        capture_output=True, text=True, timeout=15,
    ).stdout
    if not robots.strip():
        findings.append(finding(
            "P2", "/robots.txt", "missing-robots",
            "Empty or missing /robots.txt",
            "GET /robots.txt → empty",
            "Publish a robots.txt with sitemap pointer",
            "edges",
        ))
    elif "sitemap:" not in robots.lower():
        findings.append(finding(
            "P3", "/robots.txt", "robots-no-sitemap",
            "/robots.txt does not reference a sitemap",
            "No `Sitemap:` directive in robots.txt",
            "Add `Sitemap: <url>` line",
            "edges",
        ))
    sitemap = subprocess.run(
        ["curl", "-s", "--max-time", "10", origin + "/sitemap.xml"],
        capture_output=True, text=True, timeout=15,
    ).stdout
    if "<urlset" not in sitemap and "<sitemapindex" not in sitemap:
        findings.append(finding(
            "P2", "/sitemap.xml", "missing-sitemap",
            "Missing or invalid /sitemap.xml",
            f"GET /sitemap.xml → {len(sitemap)} chars, no <urlset>",
            "Generate a sitemap.xml",
            "edges",
        ))
    return findings


# ---------- DOM-eval mapper ----------

def map_dom(payload: dict) -> list[dict]:
    findings: list[dict] = []
    page = urlparse(payload.get("url", "")).path or "/"
    if payload.get("h1_count", 0) == 0:
        findings.append(finding("P1", page, "no-h1",
                                "Page has no H1", "DOM scan: 0 <h1> elements",
                                "Add a single descriptive H1", "dom"))
    elif payload.get("h1_count", 0) > 1:
        findings.append(finding("P2", page, "multiple-h1",
                                f"Page has {payload['h1_count']} H1s",
                                "DOM scan: more than one <h1>",
                                "Use a single H1 per page", "dom"))
    if payload.get("heading_skips"):
        findings.append(finding("P2", page, "heading-skips",
                                "Heading levels skipped",
                                ", ".join(payload["heading_skips"]),
                                "Fix heading hierarchy (no h2→h4 jumps)", "dom"))
    no_alt = payload.get("images_no_alt", [])
    if no_alt:
        findings.append(finding("P2", page, "images-no-alt",
                                f"{len(no_alt)} image(s) missing alt",
                                ", ".join(no_alt[:3]) + (" …" if len(no_alt) > 3 else ""),
                                "Add alt text to every <img>", "dom"))
    meta = payload.get("meta", {}) or {}
    if not meta.get("title"):
        findings.append(finding("P1", page, "no-title",
                                "Missing <title>", "head: no <title>",
                                "Add a descriptive <title>", "dom"))
    if not meta.get("description"):
        findings.append(finding("P2", page, "no-meta-description",
                                "Missing meta description",
                                "head: no <meta name='description'>",
                                "Add 150-160 char description", "dom"))
    if not meta.get("viewport"):
        findings.append(finding("P1", page, "no-viewport",
                                "Missing viewport meta",
                                "head: no <meta name='viewport'>",
                                "Add `<meta name='viewport' content='width=device-width,initial-scale=1'>`", "dom"))
    if not meta.get("canonical"):
        findings.append(finding("P2", page, "no-canonical",
                                "Missing canonical link",
                                "head: no <link rel='canonical'>",
                                "Add canonical URL", "dom"))
    if not meta.get("og_title") or not meta.get("og_image") or not meta.get("og_url"):
        missing = [k for k in ("og_title", "og_image", "og_url") if not meta.get(k)]
        findings.append(finding("P2", page, "incomplete-og",
                                "Incomplete Open Graph tags",
                                f"missing: {', '.join(missing)}",
                                "Add all three: og:title, og:image, og:url", "dom"))
    if not meta.get("twitter_card"):
        findings.append(finding("P3", page, "no-twitter-card",
                                "Missing twitter:card",
                                "head: no <meta name='twitter:card'>",
                                "Add `<meta name='twitter:card' content='summary_large_image'>`", "dom"))
    if not meta.get("lang"):
        findings.append(finding("P1", page, "no-html-lang",
                                "Missing <html lang> attribute",
                                "html: no lang attribute",
                                "Add `<html lang='en'>` (or appropriate code)", "dom"))
    for dep in payload.get("deprecated_meta", []):
        findings.append(finding("P2", page, f"deprecated-meta-{dep}",
                                f"Deprecated meta tag: {dep}",
                                f"<meta name='{dep}'> without the modern companion",
                                "Add `<meta name='mobile-web-app-capable' content='yes'>`", "dom"))
    if payload.get("external_no_noopener"):
        cnt = len(payload["external_no_noopener"])
        findings.append(finding("P3", page, "noopener-missing",
                                f"{cnt} target='_blank' link(s) without rel='noopener'",
                                payload["external_no_noopener"][0][:100],
                                "Add rel='noopener noreferrer'", "dom"))
    if payload.get("mixed_content"):
        findings.append(finding("P0", page, "mixed-content",
                                f"{len(payload['mixed_content'])} resource(s) loaded over HTTP on HTTPS page",
                                payload["mixed_content"][0][:120],
                                "Switch to HTTPS or relative URLs", "dom"))
    tap = payload.get("tap_targets_too_small", [])
    if tap:
        findings.append(finding("P2", page, "tap-targets-small",
                                f"{len(tap)} tap target(s) < 44px",
                                "; ".join(f"{t['tag']} '{t['text'][:20]}' {t['w']}×{t['h']}" for t in tap[:3]),
                                "Increase tap target to ≥44×44px (WCAG 2.5.5 / Apple HIG)", "dom"))
    if payload.get("buttons_no_name", 0) > 0:
        findings.append(finding("P1", page, "buttons-no-name",
                                f"{payload['buttons_no_name']} button(s) without accessible name",
                                "DOM: <button> with no text, aria-label, or title",
                                "Add visible text or aria-label", "dom"))
    for form in payload.get("forms", []):
        if form.get("inputs_unlabelled", 0) > 0:
            findings.append(finding("P1", page, "form-inputs-unlabelled",
                                    f"{form['inputs_unlabelled']} unlabelled input(s)",
                                    f"form action={form.get('action')}",
                                    "Wrap inputs in <label> or add aria-label", "dom"))
    return findings


# ---------- CLI ----------

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--lighthouse", type=Path, help="Path to lighthouse JSON output")
    p.add_argument("--headers", type=str, help="Origin URL (https://host)")
    p.add_argument("--edges", type=str, help="Origin URL (https://host)")
    p.add_argument("--dom", type=Path, help="Path to JSON dump from browser_evaluate DOM payload")
    args = p.parse_args()

    findings: list[dict] = []
    if args.lighthouse:
        findings += parse_lighthouse(args.lighthouse)
    if args.headers:
        findings += check_headers(args.headers)
    if args.edges:
        findings += check_edges(args.edges)
    if args.dom:
        findings += map_dom(json.loads(args.dom.read_text()))

    severity_rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    findings.sort(key=lambda f: (severity_rank.get(f["severity"], 9),
                                  (f["page"] or "/").count("/"),
                                  -f.get("occurrences", 1)))
    json.dump(findings, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
