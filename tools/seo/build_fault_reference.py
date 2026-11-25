"""Build the PowerFlex 525 fault-code reference page for the new FactoryLM site.

Every fact on the page comes from the verified drive pack
(mira-web/src/data/drive-packs/powerflex_525.json, 48/48 names located on their
cited manual pages) or is quoted from Rockwell 520-UM001O-EN-E p.160. Nothing is
written from memory: codes whose fault type the pack excerpt does not show say
"see manual" instead of a guess.

Why the page exists: AI answer engines cite one complete fault-code page per drive
(fabrico.io's PowerFlex 525 page is cited for F004 and overcurrent questions). Our
47 per-code pages are each under 300 words and there was no list page at all.

Run:  python3 tools/seo/build_fault_reference.py          (writes the page + manifest)
      python3 tools/seo/build_fault_reference.py --check  (CI: fails if out of date)
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "mira-web/src/data/drive-packs/powerflex_525.json"
SITE = ROOT / "mira-web/src/factorylm-ui/marketing-next/site"
MANIFEST = ROOT / "mira-web/src/factorylm-ui/marketing-next/manifest.json"
TEMPLATE = SITE / "limitations.html"
ROUTE = "/powerflex-525-fault-codes"
FILE = "powerflex-525-fault-codes.html"
URL = "https://factorylm.com" + ROUTE
UPDATED = "2026-11-25"
TITLE = "PowerFlex 525 Fault Codes: Full List with Manual Pages"
DESC = (
    "All 48 PowerFlex 525 fault codes with name, fault type and the 520-UM001 manual page,"
    " plus Rockwell's steps to clear a fault. Free, no sign-in."
)
MANUAL = "PowerFlex 525 User Manual, Rockwell publication 520-UM001O-EN-E (September 2025)"


def rows() -> list[dict]:
    pack = json.loads(PACK.read_text())
    names = pack["live_decode"]["fault_codes"]
    src = {}
    for s in pack["provenance"]["sources"]:
        m = re.match(r"F(\d{3})(?:\(\d\))?\s+(.*)", s["excerpt"])
        if m:
            src[int(m.group(1))] = (s["page"], m.group(2))
    out = []
    for key, name in sorted(names.items(), key=lambda kv: int(kv[0])):
        n = int(key)
        page, rest = src.get(n, (None, ""))
        ftype = None
        if rest.startswith(name):
            m = re.match(r"\s*([12])\b", rest[len(name) :])
            ftype = m.group(1) if m else None
        ftype = TYPE_OVERRIDES.get(n, ftype)
        out.append({"n": n, "code": f"F{n:03d}", "name": name, "type": ftype, "page": page})
    if len(out) != 48 or any(r["page"] is None for r in out):
        raise SystemExit("pack changed: expected 48 codes, each with a manual page")
    return out


# The flattened manual text shows ONE Type cell shared by each grouped row, which the
# per-code pack excerpts miss: "F038/F039/F040 ... 2 detected between the drive and
# motor" and "F041/F042/F043 ... 2 detected between these two output terminals"
# (520-UM001O-EN-E pp.161-162). F013 is "1(2)": footnote (2), it may be auto-cleared once.
TYPE_OVERRIDES = {38: "2", 39: "2", 40: "2", 41: "2", 42: "2", 43: "2"}
TYPE_NOTES = {13: "Type 1 (auto-restart attempts it once)"}


FAQ = [
    (
        "What does PowerFlex 525 fault F004 mean?",
        "F004 is UnderVoltage, a Type 1 fault, listed in the fault table on page 161 of 520-UM001.",
    ),
    (
        "How do I clear a PowerFlex 525 fault?",
        "Correct the cause first. Rockwell's manual (page 160) then lists four ways to clear it:"
        " press Stop if P045 [Stop Mode] is set between 0 and 3, cycle drive power, set A551"
        " [Fault Clear] to 1 or 2, or cycle a digital input set to 13 Clear Fault.",
    ),
    (
        "What is the difference between Type 1 and Type 2 faults?",
        "Auto Restart (A541, A542) can reset only certain faults. Type 1 faults can be reset by"
        " Auto Restart. Type 2 faults indicate a possible drive component malfunction and are not"
        " resettable by Auto Restart (manual page 160).",
    ),
    (
        "Where is the full PowerFlex 525 fault table?",
        "In Fault Descriptions, pages 161 to 163 of " + MANUAL + ". It lists the causes and"
        " corrective actions for each fault.",
    ),
    (
        "Can an AI answer PowerFlex 525 fault questions from the manual?",
        "FactoryLM's MIRA answers from the manual you attach to an equipment notebook and cites"
        " the page, so you can check the answer against Rockwell's text.",
    ),
]


def body(rs: list[dict]) -> str:
    e = html.escape
    trs = "\n".join(
        f'<tr><td><a href="/drive-commander/powerflex-525/faults/{r["code"]}">{r["code"]}</a></td>'
        f"<td>{e(r['name'])}</td><td>{TYPE_NOTES.get(r['n']) or (('Type ' + r['type']) if r['type'] else 'see manual')}</td>"
        f"<td>p.{r['page']}</td></tr>"
        for r in rs
    )
    type2 = ", ".join(f"{r['code']} {e(r['name'])}" for r in rs if r["type"] == "2")
    faq = "\n".join(f"<h3>{e(q)}</h3>\n<p>{e(a)}</p>" for q, a in FAQ)
    return f"""<main id="main">
<section class="page-hero"><div class="wrap"><p class="eyebrow">Drive fault codes · Rockwell PowerFlex 525</p><h1>PowerFlex 525 fault codes</h1><p class="lede">All 48 fault codes with name, fault type and the page in Rockwell's manual. Updated {UPDATED}.</p></div></section>
<section class="doc"><div class="wrap doc-grid"><nav class="toc" aria-label="On this page"><a href="#list">Fault code list</a><a href="#types">Fault types</a><a href="#clear">Clearing a fault</a><a href="#faq">Questions</a><a href="#safety">Safety</a></nav><div>
<p>Source: {e(MANUAL)}, Fault Descriptions, pages 161 to 163. Every name and page below was located in the manual's fault table. Causes and corrective actions are on those pages; open a code for its page, or attach the manual to MIRA and ask.</p>
<h2 id="list">Fault code list</h2>
<div class="table-wrap"><table>
<thead><tr><th>Code</th><th>Fault</th><th>Type</th><th>Manual page</th></tr></thead>
<tbody>
{trs}
</tbody></table></div>
<h2 id="types">Fault types</h2>
<p>The manual (page 160) says Auto Restart (A541 [Auto Rstrt Tries], A542 [Auto Rstrt Delay]) can reset only certain faults. Type 1 faults can be reset by Auto Restart. Type 2 faults indicate a possible drive component malfunction and are not resettable by Auto Restart.</p>
<p>Type 2 in this list: {type2}.</p>
<h2 id="clear">Clearing a fault (manual page 160)</h2>
<div class="safety-card"><p>Lock out per site procedure before working on a faulted drive. Confirm it is safe for the drive and the machine to run before clearing a fault.</p></div>
<ol>
<li>Press Esc to acknowledge the fault. Check b007 [Fault 1 Code] for the most recent fault.</li>
<li>Address the condition that caused the fault. The cause must be corrected before the fault can be cleared.</li>
<li>Clear the fault: press Stop if P045 [Stop Mode] is set between 0 and 3, cycle drive power, set A551 [Fault Clear] to 1 "Reset Fault" or 2 "Clear Buffer", or cycle a digital input set to 13 "Clear Fault".</li>
</ol>
<p>Rockwell cautions that with Auto Restart the drive attempts to issue its own start command, without user or application intervention: "Use caution when enabling this feature." Rockwell also warns that equipment damage and/or personal injury may result if these parameters are used in an inappropriate application.</p>
<h2 id="faq">Questions</h2>
{faq}
<h2 id="safety">Safety</h2>
<div class="safety-card"><p>Disconnect power per the equipment manual and lock out per site procedure.</p></div>
<p style="margin-top:16px">This page lists what each code is called and where Rockwell describes it. It is not a repair procedure. Follow the manual's corrective actions, your site's lockout/tagout and arc flash procedures, and qualified personnel.</p>
<div class="related"><a href="/start"><b>Ask MIRA with your manual</b><span>Free for technicians</span></a><a href="/drive-commander/powerflex-525"><b>PowerFlex 525 drive page</b><span>Parameters and faults</span></a><a href="/limitations"><b>Limitations &amp; safety</b><span>What MIRA does and doesn't do</span></a></div>
</div></div></section>
</main>"""


def ld(rs: list[dict]) -> str:
    graph = [
        {
            "@type": "TechArticle",
            "@id": URL + "#article",
            "headline": TITLE,
            "description": DESC,
            "url": URL,
            "dateModified": UPDATED,
            "datePublished": UPDATED,
            "publisher": {"@id": "https://factorylm.com/#organization"},
            "about": {
                "@type": "Product",
                "name": "PowerFlex 525",
                "manufacturer": {"@type": "Organization", "name": "Rockwell Automation"},
            },
            "citation": MANUAL,
        },
        {
            "@type": "FAQPage",
            "@id": URL + "#faq",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                for q, a in FAQ
            ],
        },
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "position": 1,
                    "name": "FactoryLM",
                    "item": "https://factorylm.com/",
                },
                {
                    "@type": "ListItem",
                    "position": 2,
                    "name": "PowerFlex 525 fault codes",
                    "item": URL,
                },
            ],
        },
    ]
    return json.dumps(graph, ensure_ascii=False)


def render() -> str:
    t = TEMPLATE.read_text()
    old_title = re.search(r"<title>(.*?)</title>", t).group(1)
    old_desc = re.search(r'<meta name="description" content="(.*?)">', t).group(1)
    t = t.replace(old_title, html.escape(TITLE)).replace(old_desc, html.escape(DESC, quote=True))
    t = t.replace("https://factorylm.com/limitations", URL)
    # Keep the site-wide nodes (Organization, WebSite); drop the template page's own.
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', t, re.S)
    data = json.loads(m.group(1))
    site_nodes = [n for n in data["@graph"] if n.get("@type") in ("Organization", "WebSite")]
    data["@graph"] = json.loads(ld(rows())) + site_nodes
    t = t.replace(m.group(1), json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    t = re.sub(r'<main id="main">.*?</main>', lambda _m: body(rows()), t, count=1, flags=re.S)
    return t


def manifest_text(page: str) -> str:
    m = json.loads(MANIFEST.read_text())
    m["routes"][ROUTE] = FILE
    # The router only serves files listed here (an allowlist, not an integrity check).
    m["files"][FILE] = hashlib.sha256(page.encode()).hexdigest()
    # The discovery files this page is listed in are kept truthful too.
    for name in ("sitemap-site.xml", "llms.txt", "llms-full.txt"):
        m["files"][name] = hashlib.sha256((SITE / name).read_bytes()).hexdigest()
    m["redirects"]["/" + FILE] = ROUTE
    m["redirects"][ROUTE + "/"] = ROUTE
    # The legacy drive URL that returned 404 now lands on the list.
    m["redirects"]["/drive-commander/powerflex-525/faults"] = ROUTE
    return json.dumps(m, indent=2) + "\n"


def main() -> int:
    page = render()
    man = manifest_text(page)
    if "--check" in sys.argv:
        stale = (SITE / FILE).read_text() != page or MANIFEST.read_text() != man
        print("STALE: run tools/seo/build_fault_reference.py" if stale else "up to date")
        return 1 if stale else 0
    (SITE / FILE).write_text(page)
    MANIFEST.write_text(man)
    print(f"wrote {FILE} ({len(page)} bytes) and manifest route {ROUTE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
