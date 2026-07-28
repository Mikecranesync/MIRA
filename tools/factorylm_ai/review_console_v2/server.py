#!/usr/bin/env python3
"""MIRA Review Console v2 — stdlib-only HTTP server (SPEC.md is authoritative).

Runtime work dir defaults to C:/Users/hharp/Documents/mira-review-v2 and is
overridable via env MIRA_REVIEW_V2_DIR (frozen dataset/manifest/downloads are
similarly overridable for testing; production defaults match the SPEC).

Run:        py -3 server.py
Self-test:  py -3 server.py --selftest
"""

from __future__ import annotations

import hmac
import json
import os
import re
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# --------------------------------------------------------------------------
# Paths (SPEC defaults; env-overridable for testing only)
# --------------------------------------------------------------------------
WORK_DIR = Path(os.environ.get("MIRA_REVIEW_V2_DIR", r"C:\Users\hharp\Documents\mira-review-v2"))
DATASET_PATH = Path(
    os.environ.get(
        "MIRA_REVIEW_V2_DATASET",
        r"C:\wt-wire\docs\zta\technician-dataset-v0\candidate_dataset.jsonl",
    )
)
MANIFEST_PATH = Path(
    os.environ.get(
        "MIRA_REVIEW_V2_MANIFEST",
        r"C:\wt-wire\docs\zta\technician-dataset-v0\candidate_manifest.json",
    )
)
DOWNLOADS_DIR = Path(os.environ.get("MIRA_REVIEW_V2_DOWNLOADS", r"C:\Users\hharp\Downloads"))

REQUIRED_SOURCES = ["printsense", "drive_commander"]
VALUED_TYPES = {"uncertainty", "refusal", "correction"}
ACTIONS = {"approve", "correct", "reject", "hold_out", "clear"}
KEPT_ACTIONS = {"approve", "correct"}
SECRET_MARKERS = ("api_key", "apikey", "bearer ", "together_api", "private_key", "secret")
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$")


def _is_final(d: dict) -> bool:
    """A decision that is safe to export and count toward the gate."""
    if d.get("invalid"):
        return False
    if d["action"] == "correct" and not str(d.get("correction_text", "")).strip():
        return False
    return True
DECISION_SCHEMA = "factorylm.technician-dataset.review-decision.v1"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# --------------------------------------------------------------------------
# Application state
# --------------------------------------------------------------------------
class AppState:
    def __init__(
        self,
        work_dir: Path = WORK_DIR,
        dataset_path: Path = DATASET_PATH,
        manifest_path: Path = MANIFEST_PATH,
        downloads_dir: Path = DOWNLOADS_DIR,
    ) -> None:
        self.work_dir = Path(work_dir)
        self.dataset_path = Path(dataset_path)
        self.manifest_path = Path(manifest_path)
        self.downloads_dir = Path(downloads_dir)
        self.data_dir = self.work_dir / "data"
        self.snippets_dir = self.work_dir / "snippets"
        self.events_path = self.data_dir / "events.jsonl"
        self.comments_path = self.data_dir / "comments.jsonl"
        self.replies_path = self.data_dir / "replies.jsonl"
        self.lock = threading.Lock()

        cfg = json.loads((self.work_dir / "config.json").read_text(encoding="utf-8"))
        self.token = str(cfg["token"])
        self.reviewer_id = str(cfg["reviewer_id"])
        self.port = int(cfg.get("port", 8377))

        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.manifest_sha = manifest["manifest_sha256"]
        self.content_hash = {e["record_id"]: e["content_hash"] for e in manifest["entries"]}

        records = []
        with self.dataset_path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        approvable = [
            r
            for r in records
            if r.get("split") == "train" and r.get("rights", {}).get("training_allowed") is True
        ]
        self.queue = self._build_queue(approvable)
        self.rec_by_id = {r["record_id"]: r for r in self.queue}

        self.data_dir.mkdir(parents=True, exist_ok=True)
        # last-wins decision map: record_id -> decision dict (clear removes)
        self.decisions: dict[str, dict] = {}
        self.events_count = 0
        self.decisions_version = 0
        self.last_event_ts: str | None = None
        self._replay_or_preload()

    # -- queue math (SPEC pseudocode, exactly) ------------------------------
    @staticmethod
    def _build_queue(recs: list[dict]) -> list[dict]:
        by_lin: dict[str, list[dict]] = {}
        for r in recs:
            by_lin.setdefault(r["document_lineage_key"], []).append(r)
        groups = sorted(
            by_lin.values(),
            key=lambda g: (REQUIRED_SOURCES.index(g[0]["source_system"]), -len(g)),
        )
        queue: list[dict] = []
        i = 0
        while True:
            added = False
            for g in groups:
                if i < len(g):
                    queue.append(g[i])
                    added = True
            if not added:
                break
            i += 1
        return queue

    # -- events / preload ----------------------------------------------------
    def _apply_event(self, ev: dict) -> None:
        rid = ev.get("record_id")
        action = ev.get("action")
        if rid not in self.rec_by_id or action not in ACTIONS:
            return
        self.events_count += 1
        self.decisions_version += 1
        self.last_event_ts = ev.get("ts")
        if action == "clear":
            self.decisions.pop(rid, None)
        else:
            self.decisions[rid] = {
                "action": action,
                "rationale": ev.get("rationale", ""),
                "correction_text": ev.get("correction_text", ""),
                "decided_at": ev.get("ts") or _now_iso(),
                "needs_correction_reentry": bool(ev.get("needs_correction_reentry", False)),
                "invalid": bool(ev.get("invalid", False)),
                "client_ts": ev.get("client_ts"),
            }

    def _append_event(self, ev: dict) -> None:
        # A crash can leave a torn last line; appending onto it would merge two
        # events into one unparseable line. Heal by prefixing a newline.
        prefix = ""
        if self.events_path.exists() and self.events_path.stat().st_size > 0:
            with self.events_path.open("rb") as rf:
                rf.seek(-1, os.SEEK_END)
                if rf.read(1) != b"\n":
                    prefix = "\n"
        with self.events_path.open("a", encoding="utf-8") as fh:
            fh.write(prefix + json.dumps(ev, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        self._apply_event(ev)

    def _replay_or_preload(self) -> None:
        if self.events_path.exists() and self.events_path.stat().st_size > 0:
            with self.events_path.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self._apply_event(json.loads(line))
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        continue
            return
        # events.jsonl absent/empty: seed from newest Downloads decisions*.jsonl
        candidates = sorted(
            self.downloads_dir.glob("decisions*.jsonl"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            return
        try:
            rows = []
            with candidates[0].open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line:
                        rows.append(json.loads(line))
        except (OSError, json.JSONDecodeError):
            return
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = row.get("record_id")
            action = row.get("action")
            if rid not in self.rec_by_id or action not in ACTIONS or action == "clear":
                continue
            ev = {
                "ts": row.get("decided_at") or _now_iso(),
                "record_id": rid,
                "action": action,
                "rationale": str(row.get("rationale", "")),
                "correction_text": "",
            }
            if action == "correct":
                msgs = row.get("correction_messages")
                text = None
                buggy = not isinstance(msgs, list) or not msgs
                if isinstance(msgs, list):
                    if any(not isinstance(m, dict) or m == {} for m in msgs):
                        buggy = True
                    else:
                        for m in msgs:
                            if m.get("role") == "assistant":
                                text = m.get("content")
                        if not isinstance(text, str) or not text.strip():
                            buggy = True
                if buggy:
                    ev["needs_correction_reentry"] = True
                    ev["correction_text"] = ""
                else:
                    ev["correction_text"] = text
            # Preloaded rows bypass the POST validators, but the importer will
            # fail-close the whole batch on any of these — quarantine instead.
            scan = ("%s %s" % (ev["rationale"], ev["correction_text"])).lower()
            if (not ev["rationale"].strip()
                    or any(m in scan for m in SECRET_MARKERS)):
                ev["invalid"] = True
                ev["needs_correction_reentry"] = True
            if not _ISO_RE.match(str(ev["ts"] or "")):
                ev["ts"] = _now_iso()
            self._append_event(ev)

    # -- gate ----------------------------------------------------------------
    def gate(self) -> dict:
        kept = [self.rec_by_id[rid] for rid, d in self.decisions.items()
                if d["action"] in KEPT_ACTIONS and _is_final(d)]
        lineages = {r["document_lineage_key"] for r in kept}
        valued = [r for r in kept if r.get("interaction_type") in VALUED_TYPES]
        safety = [r for r in kept if r.get("safety", {}).get("safety_sensitive")]
        have = sorted({r["source_system"] for r in kept})
        checks = {
            "records": {"n": len(kept), "need": 100, "ok": len(kept) >= 100},
            "lineages": {"n": len(lineages), "need": 20, "ok": len(lineages) >= 20},
            "valued": {"n": len(valued), "need": 20, "ok": len(valued) >= 20},
            "safety": {"n": len(safety), "need": 15, "ok": len(safety) >= 15},
            "sources": {
                "have": have,
                "need": list(REQUIRED_SOURCES),
                "ok": all(s in have for s in REQUIRED_SOURCES),
            },
        }
        checks["met"] = all(c["ok"] for c in checks.values() if isinstance(c, dict))
        return checks

    # -- API payload builders --------------------------------------------------
    def cards(self) -> list[dict]:
        out = []
        for n, r in enumerate(self.queue, 1):
            wp = r.get("answer_key", {}).get("withheld_payload", {})
            msgs = r.get("messages", [])
            q = next((m.get("content") for m in msgs if m.get("role") == "user"), "")
            a = next((m.get("content") for m in msgs if m.get("role") == "assistant"), "")
            rid = r["record_id"]
            out.append(
                {
                    "n": n,
                    "record_id": rid,
                    "subject": wp.get("subject"),
                    "source_system": r.get("source_system"),
                    "interaction_type": r.get("interaction_type"),
                    "safety": bool(r.get("safety", {}).get("safety_sensitive")),
                    "lineage": r.get("document_lineage_key"),
                    "q": q,
                    "a": a,
                    "claim": wp.get("claim"),
                    "facts": {
                        "status": wp.get("status"),
                        "sheet": wp.get("sheet"),
                        "page": wp.get("page"),
                        "related_parameters": wp.get("related_parameters"),
                        "source": wp.get("source"),
                    },
                    "key_ref": r.get("answer_key", {}).get("key_ref"),
                    "has_snippet": (self.snippets_dir / (rid + ".png")).is_file(),
                }
            )
        return out

    def read_comments(self) -> list[dict]:
        return self._read_jsonl(self.comments_path)

    def read_replies(self) -> list[dict]:
        return self._read_jsonl(self.replies_path)

    @staticmethod
    def _read_jsonl(path: Path) -> list[dict]:
        rows: list[dict] = []
        if not path.exists():
            return rows
        try:
            with path.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(row, dict):
                        rows.append(row)
        except OSError:
            pass
        return rows

    def add_comment(self, record_id, text: str) -> str:
        cid = "c%d" % time.time_ns()
        row = {"id": cid, "ts": _now_iso(), "record_id": record_id, "text": text}
        with self.comments_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        return cid

    # -- export (importer-shaped; SPEC "Export shape") -------------------------
    def export_lines(self) -> list[str]:
        lines = []
        for r in self.queue:
            rid = r["record_id"]
            d = self.decisions.get(rid)
            if d is None:
                continue
            # Re-entry rows and quarantined preloads are not final decisions —
            # exporting them would fail-close the whole import batch.
            if not _is_final(d):
                continue
            payload = {
                "schema": DECISION_SCHEMA,
                "action": d["action"],
                "record_id": rid,
                "candidate_content_hash": self.content_hash[rid],
                "candidate_manifest_sha256": self.manifest_sha,
                "reviewer_id": self.reviewer_id,
                "rationale": d["rationale"],
                "decided_at": d["decided_at"],
            }
            if d["action"] == "correct":
                msgs = json.loads(json.dumps(r.get("messages", [])))
                for m in msgs:
                    if m.get("role") == "assistant":
                        m["content"] = d.get("correction_text", "")
                payload["correction_messages"] = msgs
            if d["action"] == "reject":
                payload["rejection_reasons"] = [d["rationale"]]
            lines.append(json.dumps(payload, sort_keys=True, ensure_ascii=False))
        return lines


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MiraReviewV2/2.0"

    @property
    def state(self) -> AppState:
        return self.server.app_state  # type: ignore[attr-defined]

    # quiet logging + quiet client-disconnects
    def log_message(self, fmt, *args):  # noqa: A002
        pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, TimeoutError):
            self.close_connection = True

    # -- response helpers ------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            self.close_connection = True

    def _json(self, obj, code: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _err(self, code: int, msg: str) -> None:
        # Close on client errors: a 403 sent before draining the request body
        # would otherwise poison the keep-alive stream (body bytes parsed as
        # the next request line).
        if code in (400, 403, 413):
            self.close_connection = True
        self._json({"ok": False, "error": msg}, code)

    # -- auth -------------------------------------------------------------------
    def _authed(self, query: dict) -> bool:
        k = (query.get("k") or [""])[0]
        return hmac.compare_digest(k.encode("utf-8"), self.state.token.encode("utf-8"))

    # -- routes -------------------------------------------------------------------
    def do_GET(self):  # noqa: N802
        try:
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            path = urllib.parse.unquote(parsed.path)
            if not self._authed(query):
                self._err(403, "forbidden")
                return
            st = self.state
            if path == "/":
                index = st.work_dir / "index.html"
                if not index.is_file():
                    self._err(404, "index.html not found")
                    return
                self._send(200, index.read_bytes(), "text/html; charset=utf-8")
            elif path == "/api/bootstrap":
                with st.lock:
                    replies = st.read_replies()
                    self._json(
                        {
                            "manifest_sha": st.manifest_sha,
                            "reviewer_id": st.reviewer_id,
                            "cards": st.cards(),
                            "decisions": st.decisions,
                            "comments": st.read_comments(),
                            "replies": replies,
                            "gate": st.gate(),
                            "seq": len(replies),
                        }
                    )
            elif path.startswith("/api/snippet/"):
                rid = path[len("/api/snippet/"):]
                if rid not in st.rec_by_id:
                    self._err(404, "unknown record_id")
                    return
                png = st.snippets_dir / (rid + ".png")
                if not png.is_file():
                    self._err(404, "no snippet")
                    return
                self._send(
                    200,
                    png.read_bytes(),
                    "image/png",
                    {"Cache-Control": "max-age=3600"},
                )
            elif path == "/api/updates":
                try:
                    since = int((query.get("since") or ["0"])[0])
                except ValueError:
                    since = 0
                with st.lock:
                    replies = st.read_replies()
                    self._json(
                        {
                            "seq": len(replies),
                            "replies": replies[since:] if since >= 0 else replies,
                            "decisions_version": st.decisions_version,
                        }
                    )
            elif path == "/api/export":
                with st.lock:
                    lines = st.export_lines()
                body = ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8")
                self._send(
                    200,
                    body,
                    "text/plain; charset=utf-8",
                    {"Content-Disposition": 'attachment; filename="decisions.jsonl"'},
                )
            elif path == "/api/state":
                with st.lock:
                    self._json(
                        {
                            "gate": st.gate(),
                            "decided": len(st.decisions),
                            "remaining": len(st.queue) - len(st.decisions),
                            "actions_count": st.events_count,
                            "last_event_ts": st.last_event_ts,
                        }
                    )
            else:
                self._err(404, "not found")
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001 — never kill the thread on one request
            try:
                self._err(500, "internal error: %s" % exc.__class__.__name__)
            except Exception:  # noqa: BLE001
                self.close_connection = True

    def do_POST(self):  # noqa: N802
        try:
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            if not self._authed(query):
                self._err(403, "forbidden")
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length > 0 else b""
                body = json.loads(raw.decode("utf-8")) if raw else {}
                if not isinstance(body, dict):
                    raise ValueError("body must be a JSON object")
            except (ValueError, json.JSONDecodeError):
                self._err(400, "invalid JSON body")
                return
            st = self.state
            if parsed.path == "/api/decision":
                rid = body.get("record_id")
                action = body.get("action")
                rationale = body.get("rationale")
                correction_text = body.get("correction_text", "")
                client_ts = body.get("client_ts")
                if not isinstance(rid, str) or rid not in st.rec_by_id:
                    self._err(400, "record_id is not approvable")
                    return
                if not isinstance(action, str) or action not in ACTIONS:
                    self._err(400, "invalid action")
                    return
                if not isinstance(client_ts, (int, float)):
                    client_ts = None
                if action != "clear" and (not isinstance(rationale, str) or not rationale.strip()):
                    self._err(400, "rationale is required")
                    return
                if action == "correct" and (
                    not isinstance(correction_text, str) or not correction_text.strip()
                ):
                    self._err(400, "correction_text is required for correct")
                    return
                # Mirror the importer's secret scan (_contains_secret): any of these
                # substrings anywhere in the exported row rejects the WHOLE import
                # batch, so block them at decision time with a friendly message.
                scan_text = "{} {}".format(
                    rationale if isinstance(rationale, str) else "",
                    correction_text if isinstance(correction_text, str) else "",
                ).lower()
                for marker in SECRET_MARKERS:
                    if marker in scan_text:
                        self._err(400,
                                  "the word '%s' would fail the import secret-scan — "
                                  "please rephrase (e.g. 'confidential' instead of "
                                  "'secret')" % marker)
                        return
                with st.lock:
                    cur = st.decisions.get(rid)
                # Duplicate re-send (UI retry / double-tap): no-op so decided_at
                # stays byte-stable across exports (importer conflict rule).
                if (cur is not None and action != "clear"
                        and cur["action"] == action
                        and cur["rationale"] == (rationale or "")
                        and cur.get("correction_text", "") == (correction_text or "")):
                    self._json({"ok": True, "duplicate": True, "gate": st.gate()})
                    return
                # Stale offline-queue replay: never overwrite a newer decision.
                if (cur is not None and client_ts is not None
                        and cur.get("client_ts") is not None
                        and client_ts < cur["client_ts"]):
                    self._json({"ok": True, "stale": True, "gate": st.gate()})
                    return
                ev = {
                    "ts": _now_iso(),
                    "record_id": rid,
                    "action": action,
                    "rationale": rationale if isinstance(rationale, str) else "",
                    "correction_text": correction_text if isinstance(correction_text, str) else "",
                    "client_ts": client_ts,
                }
                with st.lock:
                    st._append_event(ev)
                    self._json({"ok": True, "gate": st.gate()})
            elif parsed.path == "/api/comment":
                text = body.get("text")
                if not isinstance(text, str) or not text.strip():
                    self._err(400, "text is required")
                    return
                rid = body.get("record_id")
                if rid is not None and (not isinstance(rid, str) or rid not in st.rec_by_id):
                    self._err(400, "unknown record_id")
                    return
                with st.lock:
                    cid = st.add_comment(rid, text)
                self._json({"ok": True, "id": cid})
            else:
                self._err(404, "not found")
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001
            try:
                self._err(500, "internal error: %s" % exc.__class__.__name__)
            except Exception:  # noqa: BLE001
                self.close_connection = True


class _Server(ThreadingHTTPServer):
    # Default backlog of 5 RSTs bursts of >~30 simultaneous connections.
    request_queue_size = 128


def make_server(state: AppState, host: str = "0.0.0.0", port: int | None = None) -> ThreadingHTTPServer:
    srv = _Server((host, state.port if port is None else port), Handler)
    srv.app_state = state  # type: ignore[attr-defined]
    return srv


def main() -> None:
    state = AppState()
    srv = make_server(state)
    print(
        "MIRA Review Console v2 on http://0.0.0.0:%d/ (work dir %s, %d cards)"
        % (srv.server_address[1], state.work_dir, len(state.queue))
    )
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


# ==========================================================================
# --selftest: fabricate a tiny world in TEMP, exercise every endpoint
# ==========================================================================
def _selftest() -> int:
    import hashlib
    import shutil
    import tempfile
    import urllib.error
    import urllib.request

    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, bool(ok), detail))
        print("%s %s%s" % ("PASS" if ok else "FAIL", name, (" — " + detail) if detail and not ok else ""))

    root = Path(tempfile.mkdtemp(prefix="mira_review_v2_selftest_"))
    try:
        work = root / "work"
        downloads = root / "downloads"
        frozen = root / "frozen"
        for d in (work, work / "data", work / "snippets", downloads, frozen):
            d.mkdir(parents=True, exist_ok=True)

        token = "a3f1c9e2b7d84f60"
        (work / "config.json").write_text(
            json.dumps({"token": token, "reviewer_id": "mike@cranesync.com", "port": 0}),
            encoding="utf-8",
        )
        (work / "index.html").write_text(
            "<!doctype html><title>MIRA rev\u00fc \U0001f527</title>", encoding="utf-8"
        )

        def rec(rid, lin, src, itype, safety, subject, extra_facts=None):
            wp = {
                "claim": "claim for %s \u2014 caf\u00e9" % rid,
                "id": "t:" + rid,
                "kind": "terminal",
                "review_hint": "hint",
                "safety_sensitive": safety,
                "source": "src/%s.csv" % rid,
                "subject": subject,
            }
            wp.update(extra_facts or {})
            return {
                "record_id": rid,
                "split": "train",
                "rights": {"training_allowed": True},
                "document_lineage_key": lin,
                "source_system": src,
                "interaction_type": itype,
                "safety": {"safety_sensitive": safety},
                "answer_key": {"key_ref": "pack/data#" + rid, "withheld_payload": wp},
                "messages": [
                    {"role": "system", "content": "sys"},
                    {"role": "user", "content": "Q for %s?" % rid},
                    {"role": "assistant", "content": "A for %s \u2014 \u00e9tape" % rid},
                ],
            }

        recs = [
            rec("ps-1", "lin:ps-a", "printsense", "diagnostic", False, "PLC1.+CM0",
                {"sheet": "E-001", "status": "field_verify"}),
            rec("ps-2", "lin:ps-a", "printsense", "uncertainty", True, "PLC1.+24V",
                {"sheet": "E-002", "status": "verified"}),
            rec("ps-3", "lin:ps-b", "printsense", "refusal", False, "K1 coil",
                {"sheet": "E-003", "status": "verified"}),
            rec("dc-1", "lin:dc-a", "drive_commander", "correction", True, "P09.03",
                {"page": 12, "related_parameters": ["P09.01"]}),
            rec("dc-2", "lin:dc-b", "drive_commander", "diagnostic", False, "P02.00",
                {"page": 4}),
        ]
        # non-approvable rows (must be filtered out)
        recs.append(
            {**rec("ho-1", "lin:ps-a", "printsense", "diagnostic", False, "held"), "split": "holdout"}
        )
        bad_rights = rec("nr-1", "lin:dc-a", "drive_commander", "diagnostic", False, "norights")
        bad_rights["rights"] = {"training_allowed": False}
        recs.append(bad_rights)

        ds = frozen / "candidate_dataset.jsonl"
        ds.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs), encoding="utf-8")
        manifest_sha = hashlib.sha256(b"fake-manifest").hexdigest()
        manifest = {
            "manifest_sha256": manifest_sha,
            "entries": [
                {"record_id": r["record_id"], "content_hash": hashlib.sha256(r["record_id"].encode()).hexdigest()}
                for r in recs
            ],
        }
        mf = frozen / "candidate_manifest.json"
        mf.write_text(json.dumps(manifest), encoding="utf-8")

        # tiny valid-enough PNG payload for ps-1
        png_bytes = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000a49444154789c6300010000050001"
            "0d0a2db40000000049454e44ae426082"
        )
        (work / "snippets" / "ps-1.png").write_bytes(png_bytes)

        # preload file in fake Downloads: 1 approve + 1 buggy correct ({} messages)
        preload = [
            {"record_id": "ps-3", "action": "approve", "rationale": "preloaded ok",
             "decided_at": "2026-07-25T10:00:00Z"},
            {"record_id": "dc-1", "action": "correct", "rationale": "preloaded corr",
             "decided_at": "2026-07-25T10:01:00Z", "correction_messages": [{}, {}, {}]},
            {"record_id": "not-a-real-id", "action": "approve", "rationale": "skip me",
             "decided_at": "2026-07-25T10:02:00Z"},
        ]
        (downloads / "decisions_v1.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in preload), encoding="utf-8"
        )

        state = AppState(work, ds, mf, downloads)

        # ---- queue order (mirror of SPEC pseudocode, computed independently)
        # groups: ps-a(2 recs) then ps-b(1) then dc-a(1)/dc-b(1) (insertion order ties)
        expected_queue = ["ps-1", "ps-3", "dc-1", "dc-2", "ps-2"]
        got_queue = [r["record_id"] for r in state.queue]
        check("queue order matches SPEC pseudocode", got_queue == expected_queue, str(got_queue))
        check("non-approvable records filtered", "ho-1" not in state.rec_by_id and "nr-1" not in state.rec_by_id)

        # ---- preload applied (events.jsonl was empty)
        check("preload: approve row seeded", state.decisions.get("ps-3", {}).get("action") == "approve")
        d = state.decisions.get("dc-1", {})
        check(
            "preload: buggy correct flagged needs_correction_reentry",
            d.get("action") == "correct" and d.get("needs_correction_reentry") is True
            and d.get("correction_text") == "",
        )
        check("preload: unknown record_id skipped", "not-a-real-id" not in state.decisions)
        check("preload wrote events.jsonl", state.events_path.stat().st_size > 0)

        srv = make_server(state, host="127.0.0.1", port=0)
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        base = "http://127.0.0.1:%d" % port

        def http(path, data=None, tok=token, want_headers=False):
            url = base + path + ("&" if "?" in path else "?") + "k=" + tok
            req = urllib.request.Request(
                url,
                data=json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None,
                headers={"Content-Type": "application/json"} if data is not None else {},
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    body = resp.read()
                    return (resp.status, body, dict(resp.headers)) if want_headers else (resp.status, body)
            except urllib.error.HTTPError as e:
                body = e.read()
                return (e.code, body, dict(e.headers)) if want_headers else (e.code, body)

        # ---- token gate
        code, _ = http("/api/bootstrap", tok="wrong-token")
        check("bad token -> 403 on /api/bootstrap", code == 403)
        code, _ = http("/", tok="")
        check("missing token -> 403 on /", code == 403)

        # ---- index + multibyte Content-Length
        code, body, hdrs = http("/", want_headers=True)
        check("GET / serves index.html", code == 200 and b"MIRA" in body)
        check(
            "Content-Length correct for multibyte body",
            int(hdrs.get("Content-Length", -1)) == len(body) and len(body) > len(body.decode("utf-8").encode("ascii", "ignore")),
        )

        # ---- bootstrap
        code, body = http("/api/bootstrap")
        boot = json.loads(body.decode("utf-8"))
        check("bootstrap 200 + manifest_sha", code == 200 and boot["manifest_sha"] == manifest_sha)
        check("bootstrap reviewer_id", boot["reviewer_id"] == "mike@cranesync.com")
        check("bootstrap cards = approvable count in queue order",
              [c["record_id"] for c in boot["cards"]] == expected_queue
              and [c["n"] for c in boot["cards"]] == [1, 2, 3, 4, 5])
        c1 = boot["cards"][0]
        check("card fields (q/a/claim/facts/key_ref)",
              c1["q"] == "Q for ps-1?" and c1["a"].startswith("A for ps-1")
              and c1["facts"]["sheet"] == "E-001" and c1["facts"]["status"] == "field_verify"
              and c1["facts"]["page"] is None and c1["key_ref"] == "pack/data#ps-1")
        check("has_snippet true only where PNG exists",
              c1["has_snippet"] is True and all(c["has_snippet"] is False for c in boot["cards"][1:]))
        check("bootstrap decisions include preload", "ps-3" in boot["decisions"] and "dc-1" in boot["decisions"])

        # ---- snippet
        code, body, hdrs = http("/api/snippet/ps-1", want_headers=True)
        check("snippet 200 PNG + cache header",
              code == 200 and body == png_bytes and hdrs.get("Content-Type") == "image/png"
              and "max-age=3600" in hdrs.get("Cache-Control", ""))
        code, _ = http("/api/snippet/ps-2")
        check("snippet 404 when none", code == 404)
        code, _ = http("/api/snippet/../config.json")
        check("snippet traversal rejected", code == 404)

        # ---- decisions
        uni_rat = 'Looks right \U0001f527\U0001f44d\nline2 with "quotes" and \u2014 caf\u00e9'
        code, body = http("/api/decision", {"record_id": "ps-1", "action": "approve", "rationale": uni_rat})
        resp = json.loads(body.decode("utf-8"))
        check("decision approve (unicode rationale) ok", code == 200 and resp["ok"] is True)
        # ps-1 + preload ps-3; dc-1 is a blank-correction re-entry row and must
        # NOT count toward the gate (it is excluded from export).
        check("gate in decision response counts kept", resp["gate"]["records"]["n"] == 2)
        code, _ = http("/api/decision", {"record_id": "ps-2", "action": "approve", "rationale": "   "})
        check("blank rationale -> 400", code == 400)
        code, _ = http("/api/decision", {"record_id": "ps-2", "action": "correct", "rationale": "r"})
        check("correct without correction_text -> 400", code == 400)
        code, _ = http("/api/decision", {"record_id": "ho-1", "action": "approve", "rationale": "r"})
        check("non-approvable record_id -> 400", code == 400)
        code, _ = http("/api/decision", {"record_id": "ps-2", "action": "promote", "rationale": "r"})
        check("bad action -> 400", code == 400)
        code, _ = http("/api/decision", {"record_id": "dc-1", "action": "correct", "rationale": "fixed it",
                                         "correction_text": "Corrected answer \u2014 use P09.03 = 5 s \u2705"})
        check("correct with correction_text ok", code == 200)
        code, _ = http("/api/decision", {"record_id": "dc-2", "action": "reject", "rationale": "wrong page cited"})
        check("reject ok", code == 200)
        code, _ = http("/api/decision", {"record_id": "ps-2", "action": "hold_out", "rationale": "keep for eval"})
        check("hold_out ok", code == 200)

        # clear removes (no rationale required)
        code, _ = http("/api/decision", {"record_id": "ps-2", "action": "clear"})
        code2, body = http("/api/state")
        stt = json.loads(body.decode("utf-8"))
        check("clear removes decision", code == 200 and code2 == 200 and stt["decided"] == 4)
        check("state counts", stt["remaining"] == 1 and stt["actions_count"] >= 7 and stt["last_event_ts"])

        # correct decision replacing needs_correction_reentry clears the flag
        code, body = http("/api/bootstrap")
        boot2 = json.loads(body.decode("utf-8"))
        check("re-entered correction clears reentry flag",
              boot2["decisions"]["dc-1"]["needs_correction_reentry"] is False)

        # ---- comments
        code, body = http("/api/comment", {"record_id": "ps-1", "text": "check terminal photo \U0001f4f8"})
        cresp = json.loads(body.decode("utf-8"))
        check("comment ok + id", code == 200 and cresp["ok"] is True and cresp["id"])
        code, _ = http("/api/comment", {"record_id": None, "text": "general note"})
        check("comment with null record_id ok", code == 200)
        code, _ = http("/api/comment", {"record_id": "ps-1", "text": "  "})
        check("blank comment -> 400", code == 400)
        code, body = http("/api/bootstrap")
        boot3 = json.loads(body.decode("utf-8"))
        check("bootstrap includes comments", len(boot3["comments"]) == 2
              and boot3["comments"][0]["text"].startswith("check terminal"))

        # ---- replies + updates polling
        code, body = http("/api/updates?since=0")
        upd0 = json.loads(body.decode("utf-8"))
        check("updates empty before replies", code == 200 and upd0["seq"] == 0 and upd0["replies"] == [])
        with (work / "data" / "replies.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"id": "r1", "ts": _now_iso(), "record_id": "ps-1",
                                 "text": "Claude: verified against pack \u2714"}, ensure_ascii=False) + "\n")
        code, body = http("/api/updates?since=0")
        upd1 = json.loads(body.decode("utf-8"))
        check("updates returns new reply from disk",
              upd1["seq"] == 1 and len(upd1["replies"]) == 1 and upd1["replies"][0]["id"] == "r1")
        code, body = http("/api/updates?since=1")
        upd2 = json.loads(body.decode("utf-8"))
        check("updates since=seq returns none", upd2["seq"] == 1 and upd2["replies"] == [])
        check("updates carries decisions_version", isinstance(upd1["decisions_version"], int)
              and upd1["decisions_version"] >= 7)

        # ---- export
        code, body, hdrs = http("/api/export", want_headers=True)
        text = body.decode("utf-8")
        lines = [ln for ln in text.split("\n") if ln]
        check("export 200 text/plain attachment",
              code == 200 and hdrs.get("Content-Type", "").startswith("text/plain")
              and "decisions.jsonl" in hdrs.get("Content-Disposition", ""))
        rows = [json.loads(ln) for ln in lines]
        by_rid = {r["record_id"]: r for r in rows}
        check("export one row per decided record (clear excluded)",
              sorted(by_rid) == ["dc-1", "dc-2", "ps-1", "ps-3"] and len(rows) == 4)
        check("export lines byte-equal json.dumps(sort_keys, ensure_ascii=False)",
              all(json.dumps(json.loads(ln), sort_keys=True, ensure_ascii=False) == ln for ln in lines))
        ok_keys = True
        base_keys = {"schema", "action", "record_id", "candidate_content_hash",
                     "candidate_manifest_sha256", "reviewer_id", "rationale", "decided_at"}
        for r in rows:
            want = set(base_keys)
            if r["action"] == "correct":
                want.add("correction_messages")
            if r["action"] == "reject":
                want.add("rejection_reasons")
            if set(r) != want:
                ok_keys = False
        check("export exact key sets per action (no decision_id)", ok_keys)
        check("export schema + hashes",
              all(r["schema"] == DECISION_SCHEMA for r in rows)
              and all(r["candidate_manifest_sha256"] == manifest_sha for r in rows)
              and all(r["candidate_content_hash"] == hashlib.sha256(r["record_id"].encode()).hexdigest()
                      for r in rows))
        corr = by_rid["dc-1"]["correction_messages"]
        frozen_msgs = state.rec_by_id["dc-1"]["messages"]
        check("correction_messages = frozen messages with assistant swapped",
              len(corr) == 3
              and corr[0] == frozen_msgs[0] and corr[1] == frozen_msgs[1]
              and corr[2]["role"] == "assistant"
              and corr[2]["content"] == "Corrected answer \u2014 use P09.03 = 5 s \u2705"
              and frozen_msgs[2]["content"].startswith("A for dc-1"))
        check("rejection_reasons = [rationale] on reject only",
              by_rid["dc-2"]["rejection_reasons"] == ["wrong page cited"]
              and "rejection_reasons" not in by_rid["ps-1"])
        check("export preserves unicode rationale exactly", by_rid["ps-1"]["rationale"] == uni_rat)
        check("export decided_at ISO Z", all(
            len(r["decided_at"]) == 20 and r["decided_at"].endswith("Z") and r["decided_at"][10] == "T"
            for r in rows))
        check("export Content-Length correct for multibyte body",
              int(hdrs.get("Content-Length", -1)) == len(body))

        # ---- crash-safe resume: fresh state from same dir must match, no re-preload
        state2 = AppState(work, ds, mf, downloads)
        check("resume rebuilds last-wins map from events.jsonl",
              state2.decisions == state.decisions and "ps-2" not in state2.decisions)
        check("resume does NOT re-run preload when events exist",
              state2.decisions.get("dc-1", {}).get("correction_text", "").startswith("Corrected answer"))

        srv.shutdown()
        srv.server_close()
    finally:
        try:
            shutil.rmtree(root, ignore_errors=True)
        except OSError:
            pass

    fails = [r for r in results if not r[1]]
    print("\n%d checks, %d failed" % (len(results), len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    main()
