"""Live audit of factorylm.com — read-only crawl with Playwright."""
from __future__ import annotations
import json, time, sys
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

BASE = "https://factorylm.com"
UA = "MIRA-Audit/1.0 (internal audit)"
MAX_PAGES = 25
OUT_DIR = Path(__file__).parent
SHOT_DIR = OUT_DIR / "screenshots"
SHOT_DIR.mkdir(parents=True, exist_ok=True)

SEED_URLS = [
    "/", "/cmms", "/blog", "/activated",
    "/robots.txt", "/sitemap.xml",
    "/og-image.svg", "/og-image.png",
    "/manifest.json", "/api/health",
    "/demo/work-orders",
    # a few blog posts to spot-check dynamic routing
    "/blog/how-to-read-vfd-fault-codes",
    "/blog/what-is-cmms",
    "/blog/powerflex-f012-overcurrent",
    # feature deep-dive pages
    "/feature/fault-diagnosis",
    "/feature/cmms-integration",
    "/feature/voice-vision",
]

SKIP_PATH_SUBSTR = ["/api/stripe/webhook", "/api/register", "/api/checkout"]
AUTH_GATED_PATHS = ["/api/me", "/api/quota", "/api/billing-portal", "/demo/tenant-work-orders", "/api/ingest/manual", "/api/mira/chat"]

def is_same_origin(url: str) -> bool:
    try:
        return urlparse(url).netloc in ("", "factorylm.com", "www.factorylm.com")
    except Exception:
        return False

def normalize(url: str) -> str:
    p = urlparse(urljoin(BASE, url))
    return f"{p.scheme}://{p.netloc}{p.path}"

def should_skip(url: str) -> bool:
    path = urlparse(url).path
    return any(s in path for s in SKIP_PATH_SUBSTR)

def main():
    visited = set()
    queue = [normalize(u) for u in SEED_URLS]
    results = []
    external_links = set()
    all_links_checked = {}  # url -> status

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 800})
        page = ctx.new_page()

        # collect console errors per-page via event
        console_errors_by_url = {}
        def on_console(msg):
            if msg.type in ("error", "warning"):
                console_errors_by_url.setdefault(page.url, []).append(f"[{msg.type}] {msg.text[:200]}")
        page.on("console", on_console)

        while queue and len(visited) < MAX_PAGES:
            url = queue.pop(0)
            if url in visited or should_skip(url):
                continue
            visited.add(url)
            time.sleep(0.6)
            rec = {"url": url, "status": None, "title": None, "h1": None, "links": [], "buttons": [], "meta": {}, "console_errors": [], "img_count": 0, "img_missing_alt": 0, "script_count": 0, "blocking_scripts_in_head": 0, "has_main": False, "form_count": 0, "load_ok": False, "error": None}
            try:
                resp = page.goto(url, timeout=20000, wait_until="domcontentloaded")
                rec["status"] = resp.status if resp else None
                if resp and resp.status < 400:
                    rec["load_ok"] = True
                    rec["title"] = page.title()
                    # h1
                    h1 = page.query_selector("h1")
                    rec["h1"] = (h1.inner_text() if h1 else "")[:200]
                    # meta
                    for name, sel in [
                        ("description", "meta[name='description']"),
                        ("og:title", "meta[property='og:title']"),
                        ("og:description", "meta[property='og:description']"),
                        ("og:image", "meta[property='og:image']"),
                        ("twitter:card", "meta[name='twitter:card']"),
                        ("canonical", "link[rel='canonical']"),
                        ("viewport", "meta[name='viewport']"),
                    ]:
                        el = page.query_selector(sel)
                        if el:
                            val = el.get_attribute("content") or el.get_attribute("href") or ""
                            rec["meta"][name] = val[:300]
                    # links
                    for a in page.query_selector_all("a[href]"):
                        href = a.get_attribute("href") or ""
                        if href.startswith(("mailto:", "tel:", "#", "javascript:")):
                            rec["links"].append({"href": href, "type": "non-http"})
                            continue
                        abs_url = normalize(urljoin(url, href))
                        if is_same_origin(abs_url):
                            rec["links"].append({"href": abs_url, "type": "internal"})
                            if abs_url not in visited and abs_url not in queue and len(visited) + len(queue) < MAX_PAGES * 2 and not should_skip(abs_url):
                                # only follow HTML-ish (no .pdf, .svg, .png, etc.)
                                path_l = urlparse(abs_url).path.lower()
                                if not any(path_l.endswith(ext) for ext in (".pdf", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico", ".xml", ".txt", ".json", ".js", ".css")):
                                    queue.append(abs_url)
                        else:
                            host = urlparse(abs_url).netloc
                            external_links.add((host, abs_url))
                            rec["links"].append({"href": abs_url, "type": "external", "host": host})
                    # buttons
                    for btn in page.query_selector_all("button, [role='button']"):
                        txt = (btn.inner_text() or "")[:80]
                        aria = btn.get_attribute("aria-label") or ""
                        rec["buttons"].append({"text": txt.strip(), "aria": aria[:80]})
                    # imgs
                    imgs = page.query_selector_all("img")
                    rec["img_count"] = len(imgs)
                    rec["img_missing_alt"] = sum(1 for i in imgs if not (i.get_attribute("alt") or "").strip())
                    # scripts
                    scripts = page.query_selector_all("script[src]")
                    rec["script_count"] = len(scripts)
                    head_scripts = page.query_selector_all("head script[src]")
                    rec["blocking_scripts_in_head"] = sum(1 for s in head_scripts if not (s.get_attribute("async") or s.get_attribute("defer")))
                    # main landmark
                    rec["has_main"] = bool(page.query_selector("main"))
                    # forms
                    rec["form_count"] = len(page.query_selector_all("form"))
                    # screenshots only for HTML pages (not JSON/XML/SVG)
                    path_l = urlparse(url).path.lower()
                    if not any(path_l.endswith(ext) for ext in (".svg", ".xml", ".txt", ".json", ".png", ".jpg")):
                        slug = (urlparse(url).path or "/").strip("/").replace("/", "_") or "root"
                        try:
                            page.screenshot(path=str(SHOT_DIR / f"{slug}-desktop.png"), full_page=False)
                            page.set_viewport_size({"width": 375, "height": 812})
                            page.screenshot(path=str(SHOT_DIR / f"{slug}-mobile.png"), full_page=False)
                            page.set_viewport_size({"width": 1280, "height": 800})
                        except Exception as e:
                            rec["error"] = f"screenshot: {e}"
                rec["console_errors"] = console_errors_by_url.get(url, [])[-20:]
            except PWTimeoutError:
                rec["error"] = "timeout"
            except Exception as e:
                rec["error"] = str(e)[:200]
            results.append(rec)
            print(f"[{len(visited)}/{MAX_PAGES}] {rec['status']} {url}", flush=True)

        # HEAD-probe every unique internal link discovered (even if not navigated)
        all_internal = set()
        for r in results:
            for l in r["links"]:
                if l["type"] == "internal":
                    all_internal.add(l["href"])
        ctx2 = browser.new_context(user_agent=UA)
        page2 = ctx2.new_page()
        link_status = {}
        for link in sorted(all_internal):
            if should_skip(link) or link in visited:
                # we already have status for visited links
                if link in visited:
                    for r in results:
                        if r["url"] == link:
                            link_status[link] = r["status"]
                            break
                continue
            time.sleep(0.5)
            try:
                resp = page2.request.head(link, timeout=8000)
                link_status[link] = resp.status
            except Exception as e:
                link_status[link] = f"err: {str(e)[:80]}"
        browser.close()

    # Write results
    (OUT_DIR / "findings.json").write_text(json.dumps({"results": results, "external_links": sorted(external_links), "link_status": link_status}, indent=2))

    # Human-readable markdown
    lines = ["# factorylm.com Playwright crawl — findings", f"\n_Run: {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}, {len(visited)} pages visited_\n"]
    lines.append("## URLs crawled\n")
    lines.append("| URL | Status | Title | H1 | Errors | Links |")
    lines.append("|---|---|---|---|---|---|")
    for r in results:
        title = (r["title"] or "")[:40]
        h1 = (r["h1"] or "")[:40]
        err = len(r["console_errors"])
        links = len(r["links"])
        lines.append(f"| {r['url']} | {r['status']} | {title} | {h1} | {err} | {links} |")

    # Broken links
    broken = [(l, s) for l, s in link_status.items() if isinstance(s, int) and s >= 400]
    lines.append(f"\n## Broken internal links (4xx/5xx) — {len(broken)}")
    if broken:
        lines.append("| Link | Status |\n|---|---|")
        for l, s in sorted(broken):
            lines.append(f"| {l} | {s} |")
    else:
        lines.append("_None found._")

    # Errors during navigation
    errs = [r for r in results if r.get("error")]
    lines.append(f"\n## Navigation errors — {len(errs)}")
    for r in errs:
        lines.append(f"- {r['url']} — {r['error']}")

    # Console errors by page
    lines.append("\n## Console errors by page")
    any_console = False
    for r in results:
        if r["console_errors"]:
            any_console = True
            lines.append(f"\n### {r['url']}")
            for e in r["console_errors"]:
                lines.append(f"- {e}")
    if not any_console:
        lines.append("_None captured._")

    # Per-page meta / a11y
    lines.append("\n## Per-page meta + a11y")
    for r in results:
        if not r["load_ok"]:
            continue
        lines.append(f"\n### {r['url']}")
        lines.append(f"- Title: `{r['title']}`")
        lines.append(f"- H1: `{r['h1']}`")
        for k, v in r["meta"].items():
            lines.append(f"- meta:{k} = `{v[:120]}`")
        lines.append(f"- images: {r['img_count']} (missing alt: {r['img_missing_alt']})")
        lines.append(f"- scripts: {r['script_count']} (blocking in head: {r['blocking_scripts_in_head']})")
        lines.append(f"- has <main>: {r['has_main']}, forms: {r['form_count']}")

    # External domains summary
    ext_hosts = {}
    for r in results:
        for l in r["links"]:
            if l["type"] == "external":
                ext_hosts[l["host"]] = ext_hosts.get(l["host"], 0) + 1
    lines.append(f"\n## External link hosts\n")
    for h, c in sorted(ext_hosts.items(), key=lambda x: -x[1]):
        lines.append(f"- {h} — {c} refs")

    (OUT_DIR / "findings.md").write_text("\n".join(lines))
    print(f"\nWrote {OUT_DIR / 'findings.md'} and {OUT_DIR / 'findings.json'}")
    print(f"Screenshots in {SHOT_DIR}")

if __name__ == "__main__":
    sys.exit(main())
