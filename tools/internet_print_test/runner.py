#!/usr/bin/env python3
"""Internet Electrical Print Test Runner.

Finds/loads a PUBLIC electrical drawing, submits it through the REAL MIRA Telegram
print-translator production path (tools/internet_print_test/submit.py), preserves an
immutable per-drawing evidence directory, grades it with an independent multimodal judge,
and (optionally) emails Mike the complete report.

Default mode is --dry-run (no download, no submission, no email). Nothing is merged or
deployed. Credentials load only from Doppler; secrets are never printed.

    doppler run -p factorylm -c stg -- py -3 tools/internet_print_test/runner.py \
        --source-url https://example.org/manual.pdf --page 12 --category vfd

See PLAN.md for the architecture + reuse map.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_REPO = _HERE.parents[1]
for _p in (str(_HERE), str(_REPO), str(_REPO / "tools" / "print_translator_eval")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import mailer  # noqa: E402
import safety  # noqa: E402
from judge import judge as run_judge  # noqa: E402

TESTS_ROOT = _REPO / "internet_print_tests"
SOURCES_JSON = _HERE / "sources.json"


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _repo_version() -> dict:
    import subprocess

    def _git(*a):
        try:
            return subprocess.run(["git", *a], cwd=str(_REPO), capture_output=True, text=True).stdout.strip()
        except Exception:  # noqa: BLE001
            return ""

    ver = ""
    try:
        ver = (_REPO / "VERSION").read_text(encoding="utf-8").strip()
    except Exception:  # noqa: BLE001
        pass
    return {"commit": _git("rev-parse", "HEAD"), "branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
            "app_version": ver}


def _ext_for(mime: str | None, data: bytes) -> str:
    m = mime or safety._sniff_mime(data) or ""
    return {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
            "image/webp": "webp", "image/tiff": "tif"}.get(m, "bin")


def _acquire(src: dict, log: logging.Logger) -> tuple[bytes, dict]:
    """Return (original_bytes, download_meta). Honors --local-file or fetches the URL fail-closed."""
    lf = src.get("local_file")
    if lf:
        data = Path(lf).read_bytes()
        if len(data) > safety.MAX_BYTES:
            raise safety.FetchError(f"local file exceeds size cap {safety.MAX_BYTES}")
        mime = safety._sniff_mime(data)
        if mime not in safety.ALLOWED_MIME:
            raise safety.FetchError(f"local file type {mime!r} not in allow-list")
        log.info("loaded local file %s (%d bytes, %s)", lf, len(data), mime)
        return data, {"local_file": lf, "content_type_sniffed": mime, "bytes": len(data)}
    url = src["source_url"]
    log.info("fetching %s", url)
    data, meta = safety.Fetcher().fetch(url)
    log.info("fetched %d bytes (%s)", meta["bytes"], meta.get("content_type_sniffed") or meta.get("content_type_header"))
    return data, meta


def _tested_page(original: bytes, mime: str | None, page: int, dpi: int, td: Path, log: logging.Logger) -> bytes:
    """The image actually submitted. For a PDF, render the selected page to PNG (prod never
    interprets PDFs — it posts them to the Hub — so the honest test is the rendered page as a photo)."""
    if (mime or safety._sniff_mime(original)) == "application/pdf":
        from run import render_page  # reuse PyMuPDF renderer

        (td / "original.pdf").write_bytes(original)
        # Best-effort page-count guard: a full vendor catalog (hundreds of pages) is a wrong
        # source for a single wiring sheet — SKIP it rather than silently render page 0 of a cover.
        max_pages = int(os.getenv("PRINT_MAX_PDF_PAGES") or "600")
        try:
            import fitz  # PyMuPDF — same lib render_page uses

            with fitz.open(td / "original.pdf") as _doc:
                n_pages = _doc.page_count
            if n_pages > max_pages:
                raise SkipError(f"PDF has {n_pages} pages (> {max_pages}) — looks like a full "
                                "catalog, not a wiring sheet; pick a leaner source")
            if page >= n_pages:
                raise SkipError(f"requested page {page} out of range (PDF has {n_pages} pages)")
        except SkipError:
            raise
        except Exception as e:  # noqa: BLE001 — page-count probe is best-effort, never blocks a valid render
            log.warning("page-count probe failed (%s) — proceeding to render", e)
        png = render_page(td / "original.pdf", page, dpi=dpi, fmt="png")
        log.info("rendered PDF page %d @ %d dpi -> %d bytes PNG", page, dpi, len(png))
        return png
    # Already an image: it IS the tested page.
    return original


class SkipError(Exception):
    """A source that can't be tested for a benign, expected reason (robots.txt disallow,
    oversized/slow download, too many pages). Recorded as a typed ``skip:`` — NOT a failure,
    so one bad URL never fails the exit code or terminates an unattended batch."""


def _deterministic_grade(td: Path, result: dict, log) -> dict | None:
    """Deterministic import verdict (``printsense.grade_case``) on the extraction graph, run BEFORE
    the LLM judge — it OWNS import safety (spec §5; PRD §8.2). The judge may explain a FAIL but
    never clear it. An open-corpus print has no frozen rubric, so only the truth-free structural
    gates apply (score/tier stay ``None``). Never raises: the deterministic layer must not break a run."""
    graph = result.get("graph")
    if not isinstance(graph, dict):
        return None
    try:
        from printsense.grade_case import grade_case

        grade = grade_case(td / "extraction.json", rubric_path=None)
        log.info("deterministic import_verdict=%s blockers=%s",
                 grade.get("import_verdict"), grade.get("import_blocking_failures"))
        return grade
    except Exception as e:  # noqa: BLE001
        log.warning("deterministic grade failed: %s", e)
        return None


def _deterministic_report_lines(grade: dict | None) -> list[str]:
    if not grade:
        return []
    blockers = ", ".join(grade.get("import_blocking_failures") or []) or "none"
    return [
        "## 3a. Deterministic import gate (AUTHORITATIVE — owns import safety; an LLM judge may explain a FAIL but never clear it)",
        f"- import_verdict: **{grade.get('import_verdict')}**",
        f"- quality_tier: **{grade.get('quality_tier')}** · score: {grade.get('score')}",
        f"- import-blocking failures: {blockers}", "",
    ]


def _grade_and_deliver(td: Path, source_json: dict, result: dict, tested: bytes, args, row: dict, log) -> None:
    """Deterministic grader → judge → report → email. Shared by the normal run and --regrade (mutates `row`)."""
    grade = _deterministic_grade(td, result, log)
    # Preserve the deterministic checks as their own artifact (plan requirement — every case keeps
    # image + response + deterministic checks + judge + latency + cost).
    (td / "deterministic_grade.json").write_text(
        json.dumps(grade if grade is not None else {"deterministic_grade": "unavailable"},
                   indent=2, ensure_ascii=False), encoding="utf-8")
    graph = result.get("graph")
    final_text = result.get("final_text")
    jr = {"judge_error": "skipped"}
    if not args.no_judge and final_text:
        log.info("running independent multimodal judge…")
        jr = run_judge(tested, final_text, result.get("map_text"), source_json, media_type="image/png", graph=graph)
    (td / "judge_1.json").write_text(json.dumps(jr, indent=2, ensure_ascii=False), encoding="utf-8")

    # Independent review of any hard failure — a second, fresh judge pass (adversarial second opinion).
    # A hard failure is only "confirmed" if both independent judges agree; disagreement → needs human review.
    if jr.get("hard_failure") and not args.no_judge and final_text:
        log.info("judge_1 flagged a HARD FAILURE — escalating to an independent second judge…")
        jr2 = run_judge(tested, final_text, result.get("map_text"), source_json, media_type="image/png", graph=graph)
        (td / "judge_2.json").write_text(json.dumps(jr2, indent=2, ensure_ascii=False), encoding="utf-8")
        row["hard_failure_second_opinion"] = jr2.get("hard_failure")
        row["hard_failure_confirmed"] = bool(jr.get("hard_failure")) and bool(jr2.get("hard_failure"))
        log.info("second judge hard_failure=%s → confirmed=%s",
                 jr2.get("hard_failure"), row["hard_failure_confirmed"])

    report_md, report_html = _build_report(source_json, result, jr, _repo_version(), grade)
    (td / "report.md").write_text(report_md, encoding="utf-8")
    (td / "report.html").write_text(report_html, encoding="utf-8")

    row["email"] = _deliver(td, source_json, result, jr, grade, args, log)
    row["status"] = "ok"
    row["score"] = (jr or {}).get("overall_score_provisional")
    row["hard_failure"] = (jr or {}).get("hard_failure")
    row["import_verdict"] = (grade or {}).get("import_verdict")
    row["import_blocking_failures"] = (grade or {}).get("import_blocking_failures") or []
    row["quality_tier"] = (grade or {}).get("quality_tier")
    row["classification"] = result.get("classification")
    row["interpreter_used"] = result.get("interpreter_used")


def run_one(src: dict, args) -> dict:
    test_id = src["test_id"]
    td = TESTS_ROOT / test_id
    td.mkdir(parents=True, exist_ok=True)
    log_path = td / "run.log"
    log = logging.getLogger(test_id)
    log.setLevel(logging.INFO)
    log.handlers.clear()
    fh = logging.FileHandler(log_path, mode="w", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(fh)
    log.addHandler(logging.StreamHandler(sys.stderr))
    log.propagate = False  # don't double-echo through the root logger (keeps send-count logs unambiguous)

    row = {"test_id": test_id, "source_url": src.get("source_url"), "category": src.get("category"),
           "standard": src.get("standard"), "status": "started", "score": None,
           "hard_failure": None, "email": "not-attempted"}
    t0 = time.monotonic()
    try:
        if getattr(args, "regrade", False) and (td / "telegram_response.json").exists():
            # Re-judge saved results only — no re-download, no re-submit (no paid interpret).
            log.info("regrade: reusing saved tested_page.png + telegram_response.json")
            source_json = json.loads((td / "source.json").read_text(encoding="utf-8"))
            result = json.loads((td / "telegram_response.json").read_text(encoding="utf-8"))
            tested = (td / "tested_page.png").read_bytes()
        else:
            original, dl_meta = _acquire(src, log)
            mime = dl_meta.get("content_type_sniffed") or safety._sniff_mime(original)
            ext = _ext_for(mime, original)
            (td / f"original.{ext}").write_bytes(original)
            sha = hashlib.sha256(original).hexdigest()
            (td / "sha256.txt").write_text(f"{sha}  original.{ext}\n", encoding="utf-8")

            source_json = {
                "test_id": test_id, "source_url": src.get("source_url"),
                "publisher": src.get("publisher"), "title": src.get("title"),
                "sheet": src.get("sheet"), "equipment_type": src.get("equipment_type"),
                "standard": src.get("standard"), "category": src.get("category"),
                "why_selected": src.get("why_selected"), "access_date_utc": _utc(),
                "original_sha256": sha, "original_ext": ext, "download": dl_meta,
                "license_note": src.get("license_note", "public source — original ownership retained by publisher; retained for testing only"),
            }
            (td / "source.json").write_text(json.dumps(source_json, indent=2), encoding="utf-8")

            page = int(src.get("page", args.page))
            tested = _tested_page(original, mime, page, args.dpi, td, log)
            (td / "tested_page.png").write_bytes(tested)
            tested_sha = hashlib.sha256(tested).hexdigest()

            caption = src.get("caption", args.caption)
            (td / "telegram_request.json").write_text(json.dumps({
                "test_id": test_id, "caption": caption, "tested_page_sha256": tested_sha,
                "submitted_as": "telegram photo (in-process real handler)",
                "note": "PDF sources are rendered to a page image and submitted through the photo path, "
                        "because prod interprets photos (not raw PDFs, which post to the Hub).",
            }, indent=2), encoding="utf-8")

            # ── THE REAL PRODUCTION PATH ──
            log.info("submitting through the real handler (bot._try_print_translator_reply)…")
            from submit import submit_image_sync

            cap = safety.redact_secrets(caption)
            result = submit_image_sync(tested, cap, chat_id=f"iprt-{test_id}")
            # BYTE-FOR-BYTE: newline="" prevents Windows CRLF translation so the .txt bytes
            # equal final_text exactly (and match telegram_response.json's final_text, LF).
            (td / "telegram_response.txt").write_text(result.get("final_text") or "", encoding="utf-8", newline="")
            (td / "telegram_response.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
            (td / "extraction.json").write_text(json.dumps(result.get("graph"), indent=2, ensure_ascii=False), encoding="utf-8")
            log.info("handled=%s classification=%s interpreter_used=%s latency=%ss",
                     result.get("handled"), result.get("classification"), result.get("interpreter_used"), result.get("latency_s"))

        _grade_and_deliver(td, source_json, result, tested, args, row, log)
    except (safety.FetchError, SkipError) as e:
        # Benign, expected: robots-disallow / oversized-or-slow / too-many-pages. A typed SKIP
        # (not a failure) so it never fails the exit code or halts an unattended batch.
        log.warning("skip: %s", e)
        row["status"] = f"skip: {e}"
        row["skip"] = True
    except Exception as e:  # noqa: BLE001 — record the failure, preserve partial evidence
        log.exception("run failed")
        row["status"] = f"error: {type(e).__name__}: {e}"
    row["elapsed_s"] = round(time.monotonic() - t0, 1)
    fh.close()
    return row


def _subject(source_json: dict, jr: dict) -> str:
    title = source_json.get("title") or source_json.get("sheet") or source_json["test_id"]
    score = (jr or {}).get("overall_score_provisional")
    score_s = f"{score}/100" if isinstance(score, int) else "ungraded"
    return f"MIRA Print Translator Test — {source_json['test_id']} — {title} — {score_s}"


def _email_summary_html(source_json: dict, result: dict, jr: dict, grade: dict | None = None) -> str:
    """A concise, readable email body — the key results, NOT the full test dump.

    The full verbatim response + report + graph ride along as ATTACHMENTS; the body is a
    scannable card: title/source, system type, score/grade/hard-fail, what was understood,
    the important errors/uncertainties, and safety-performance notes.
    """
    import html as _html

    e = _html.escape
    score = jr.get("overall_score_provisional")
    score_s = f"{score}/100" if isinstance(score, int) else "ungraded"
    letter = jr.get("letter") or "—"
    hard = jr.get("hard_failure")
    hard_s, hard_color = ("YES", "#c0392b") if hard else ("No", "#2e7d32")
    strengths = (jr.get("verified_strengths") or [])[:3]
    errors = (jr.get("suspected_errors_or_hallucinations") or [])[:3]
    safety_note = ((jr.get("criteria") or {}).get("safety_language") or {}).get("note") \
        or "No specific safety-language note recorded by the judge."
    warn = next((ln.strip() for ln in (result.get("final_text") or "").splitlines()
                 if ln.strip().startswith("⚠")), "")
    url = source_json.get("source_url") or ""
    gate_html = ""
    if grade:
        iv = grade.get("import_verdict") or "—"
        iv_color = "#c0392b" if iv == "FAIL" else "#2e7d32"
        gate_blockers = ", ".join(grade.get("import_blocking_failures") or []) or "none"
        gate_html = (f"<div style='margin:6px 0 12px;font-size:13px'><b>Deterministic import gate</b> "
                     f"(authoritative): <b style='color:{iv_color}'>{e(iv)}</b> "
                     f"<span style='color:#666'>· blockers: {e(gate_blockers)}</span></div>")
    str_li = "".join(f"<li>{e(str(s))}</li>" for s in strengths) or "<li>None recorded.</li>"
    err_li = "".join(
        f"<li>{e((h.get('claim') or '')[:220])} — <span style='color:#666'>{e((h.get('why') or '')[:260])}</span></li>"
        for h in errors) or "<li>None flagged by the independent judge.</li>"
    return f"""<div style="font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;color:#222">
<h2 style="margin:0 0 2px">{e(source_json.get('title') or source_json['test_id'])}</h2>
<div style="color:#555;font-size:13px">{e(source_json.get('publisher') or '')} · <a href="{e(url)}" style="color:#3949ab">source</a></div>
<div style="margin:6px 0 14px;color:#555;font-size:13px"><b>System / circuit:</b> {e(source_json.get('equipment_type') or '')} · {e(source_json.get('category') or '')} · {e(source_json.get('standard') or '')}</div>
<table style="border-collapse:collapse;margin:0 0 4px"><tr>
<td style="padding:8px 14px;background:#f5f5f7;border-radius:8px;font-size:22px;font-weight:700">{e(score_s)} <span style="font-size:15px;color:#666">({e(letter)})</span></td>
<td style="padding:8px 14px">Hard failure: <b style="color:{hard_color}">{hard_s}</b></td>
</tr></table>
<div style="font-size:12px;color:#999;margin-bottom:14px">PROVISIONAL automated grade — not technician approval until the rubric is calibrated.</div>
{gate_html}
<h3 style="margin:14px 0 4px;font-size:15px">✅ Understood correctly</h3>
<ul style="margin:0;padding-left:20px">{str_li}</ul>
<h3 style="margin:14px 0 4px;font-size:15px">⚠️ Most important errors / uncertainties</h3>
<ul style="margin:0;padding-left:20px">{err_li}</ul>
<h3 style="margin:14px 0 4px;font-size:15px">🛟 Safety-performance notes</h3>
<div style="font-size:14px">{e(safety_note)}</div>
{("<div style='font-size:13px;color:#555;margin-top:4px'>Interpreter safety line: " + e(warn) + "</div>") if warn else ""}
<hr style="border:none;border-top:1px solid #eee;margin:16px 0">
<div style="font-size:12px;color:#888"><b>Attached:</b> original diagram · tested page (PNG) · full report (report.html) · judge result (judge_1.json) · verbatim response (telegram_response.json).<br>
{e(source_json['test_id'])} · judge {e(jr.get('judge_model') or 'n/a')} · interpret {e(result.get('model') or '')} {e(str(result.get('latency_s') or ''))}s · {e(_utc())}</div>
</div>"""


def _deliver(td: Path, source_json: dict, result: dict, jr: dict, grade: dict | None, args, log) -> str:
    # Attachments = the approved test package: the drawing + the supporting eval files.
    files = [td / "tested_page.png", td / "report.html", td / "judge_1.json", td / "telegram_response.json"]
    orig = next(td.glob("original.*"), None)
    if orig:
        files.insert(0, orig)
    subject = _subject(source_json, jr)
    recipient = args.recipient or mailer.default_recipient()
    body = _email_summary_html(source_json, result, jr, grade)  # concise summary, NOT the full dump
    pkg = mailer.build_package(subject, body, recipient, files)
    mailer.write_dry_run(td / "_email", pkg)
    log.info("email package built:\n%s", mailer.package_summary(pkg))
    if args.send_email:
        if (jr or {}).get("overall_score_provisional") is None:
            # Never send an ungraded report — a report email must carry score/grade/hard-fail.
            log.warning("email HELD — no grade available (judge failed); not sending an ungraded report")
            return "held (judge failed — not sent)"
        res = mailer.send(pkg)
        log.info("email send: %s", {k: v for k, v in res.items() if k != "error" or v})
        return "sent" if res.get("sent") else f"send-failed: {res.get('error')}"
    return "dry-run (package built, not sent)"


def _build_report(source_json: dict, result: dict, jr: dict, ver: dict, grade: dict | None = None) -> tuple[str, str]:
    resp = safety.redact_secrets(result.get("final_text") or "(no response)")
    md = [
        f"# MIRA Print Translator Test — {source_json['test_id']}", "",
        "## 1. Source & drawing metadata",
        f"- Publisher: {source_json.get('publisher')}", f"- Title: {source_json.get('title')}",
        f"- Sheet: {source_json.get('sheet')}", f"- Equipment: {source_json.get('equipment_type')}",
        f"- Standard: {source_json.get('standard')}", f"- Category: {source_json.get('category')}",
        f"- Source URL: {source_json.get('source_url')}", f"- Access date (UTC): {source_json.get('access_date_utc')}",
        f"- Original sha256: `{source_json.get('original_sha256')}`", "",
        f"## 2. Why selected\n{source_json.get('why_selected')}", "",
        "## 3. Exact Telegram bot response (verbatim, unmodified)", "", "```", resp, "```", "",
        f"- classification: **{result.get('classification')}** (conf {result.get('classification_confidence')})",
        f"- interpreter used (Anthropic PrintSynth): **{result.get('interpreter_used')}**",
        f"- model: {result.get('model')} · effort {result.get('effort')} · latency {result.get('latency_s')}s", "",
        *_deterministic_report_lines(grade),
        "## 4. LLM judge grade (PROVISIONAL, qualitative — not technician approval until Mike calibrates)",
        f"- score: **{jr.get('overall_score_provisional')}/100** ({jr.get('letter')})",
        f"- hard failure: **{jr.get('hard_failure')}**",
        f"- summary: {jr.get('summary')}", "",
        "## 5. Verified strengths",
        *[f"- {s}" for s in (jr.get("verified_strengths") or [])], "",
        "## 6. Suspected errors / hallucinations",
        *[f"- \"{h.get('claim')}\" — {h.get('why')}" for h in (jr.get("suspected_errors_or_hallucinations") or [])], "",
        "## 7. Items requiring technician review",
        *[f"- {s}" for s in (jr.get("items_requiring_technician_review") or [])], "",
        f"## 8. Build & runtime\n- commit: `{ver.get('commit')}` · branch: {ver.get('branch')} · version: {ver.get('app_version')}\n- judge model: {jr.get('judge_model')} · run: {_utc()}",
        f"\n## 9. Source URL\n{source_json.get('source_url')}",
    ]
    md_text = "\n".join(md)
    import html as _html

    html_text = (
        "<!doctype html><meta charset=utf-8><title>" + _html.escape(source_json["test_id"]) + "</title>"
        "<body style='font:14px system-ui;max-width:60rem;margin:2rem'>"
        + "".join(f"<p>{_html.escape(line)}</p>" if not line.startswith("```") else "" for line in md)
        + "<h2>Verbatim response</h2><pre style='white-space:pre-wrap;border:1px solid #ccc;padding:1rem'>"
        + _html.escape(resp) + "</pre></body>"
    )
    return md_text, html_text


# ── source selection ──────────────────────────────────────────────────────────

def _load_sources() -> list[dict]:
    if SOURCES_JSON.exists():
        return json.loads(SOURCES_JSON.read_text(encoding="utf-8"))
    return []


def _slug(s: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:48] or "src"


def _select(args) -> list[dict]:
    if args.local_file:
        p = Path(args.local_file)
        return [{"test_id": f"local-{_slug(p.stem)}", "local_file": str(p),
                 "publisher": "(local)", "title": p.name, "why_selected": "operator-supplied local file",
                 "caption": args.caption, "page": args.page}]
    if args.source_url:
        return [{"test_id": f"url-{hashlib.sha256(args.source_url.encode()).hexdigest()[:10]}",
                 "source_url": args.source_url, "publisher": "(direct URL)", "title": args.source_url,
                 "why_selected": "operator-supplied --source-url", "caption": args.caption, "page": args.page}]
    src = _load_sources()
    if getattr(args, "test_id", None):
        wanted = {t.strip() for t in args.test_id.split(",") if t.strip()}
        src = [s for s in src if s["test_id"] in wanted]
    if args.category:
        src = [s for s in src if (s.get("category") or "").lower() == args.category.lower()]
    if args.resume:
        src = [s for s in src if not (TESTS_ROOT / s["test_id"] / "telegram_response.json").exists()]
    if args.count:
        src = src[: args.count]
    return src


def _write_index(rows: list[dict]) -> None:
    TESTS_ROOT.mkdir(parents=True, exist_ok=True)
    # Merge with any existing index so running a subset preserves prior cases (e.g. the golden path).
    merged: dict[str, dict] = {}
    idx = TESTS_ROOT / "index.json"
    if idx.exists():
        for r in json.loads(idx.read_text(encoding="utf-8")):
            merged[r["test_id"]] = r
    for r in rows:
        merged[r["test_id"]] = r  # a fresh run overrides the prior row for that test_id
    allrows = list(merged.values())
    (TESTS_ROOT / "index.json").write_text(json.dumps(allrows, indent=2), encoding="utf-8")
    md = ["# Internet Print Test — aggregate index", "",
          "| test_id | source | category | standard | result | score | hard_fail | email |",
          "|---|---|---|---|---|---|---|---|"]
    for r in allrows:
        md.append(f"| {r['test_id']} | {(r.get('source_url') or '')[:40]} | {r.get('category')} | "
                  f"{r.get('standard')} | {r.get('status')} | {r.get('score')} | {r.get('hard_failure')} | {r.get('email')} |")
    (TESTS_ROOT / "index.md").write_text("\n".join(md), encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Internet Electrical Print Test Runner")
    ap.add_argument("--dry-run", action="store_true", help="validate + plan only; no download/submit/email (DEFAULT unless a run flag is given)")
    ap.add_argument("--source-url", help="test one arbitrary public URL")
    ap.add_argument("--local-file", help="test one pre-downloaded local file")
    ap.add_argument("--count", type=int, help="limit corpus entries")
    ap.add_argument("--category", help="filter corpus by category")
    ap.add_argument("--test-id", help="run only the named corpus test_id(s), comma-separated")
    ap.add_argument("--send-email", action="store_true", help="actually send (default builds the package only)")
    ap.add_argument("--recipient", help="approved recipient (default MORNING_REPORT_EMAIL/Mike)")
    ap.add_argument("--resume", action="store_true", help="skip entries that already have results")
    ap.add_argument("--regrade", action="store_true", help="re-judge existing results without re-download/submit")
    ap.add_argument("--telegram-production-path", action="store_true", help="require the real in-process handler (fail if bot not importable); never opens a live Telegram")
    ap.add_argument("--no-judge", action="store_true", help="skip the multimodal judge (offline)")
    ap.add_argument("--page", type=int, default=0, help="PDF page index to render (default 0)")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--caption", default="Explain this print.")
    args = ap.parse_args(argv)

    run_requested = any([args.source_url, args.local_file, args.count, args.category, args.regrade,
                         args.send_email, args.test_id])
    if args.dry_run or not run_requested:
        sources = _select(args)
        print(f"[DRY-RUN] {len(sources)} source(s) would run:")
        for s in sources[:50]:
            print(f"  - {s['test_id']}: {s.get('source_url') or s.get('local_file')} "
                  f"[{s.get('category')}/{s.get('standard')}]")
        print("(no download, no submission, no email — pass --source-url / --category / --count to run)")
        return 0

    if args.telegram_production_path:
        from submit import _load_real_bot

        bot, err = _load_real_bot()
        if bot is None:
            print(f"[FATAL] --telegram-production-path requires the real handler; bot import failed: {err!r}")
            return 2

    sources = _select(args)
    if not sources:
        print("no sources selected")
        return 1
    rows = [run_one(s, args) for s in sources]
    _write_index(rows)
    ok = sum(1 for r in rows if r["status"] == "ok")
    skipped = sum(1 for r in rows if str(r.get("status", "")).startswith("skip:"))
    errored = sum(1 for r in rows if str(r.get("status", "")).startswith("error:"))
    print(f"\n=== {ok}/{len(rows)} ok · {skipped} skipped · {errored} error — index at {TESTS_ROOT/'index.md'} ===")
    for r in rows:
        print(f"  {r['test_id']}: {r['status']} score={r.get('score')} hard_fail={r.get('hard_failure')} email={r.get('email')}")
    # Exit non-zero ONLY on a genuine error. Skips (robots/oversized) are expected and must
    # never fail an unattended batch (plan success gate: "rerun unattended without one URL
    # terminating the batch").
    return 1 if errored else 0


if __name__ == "__main__":
    raise SystemExit(main())
