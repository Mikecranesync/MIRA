"""Discovery adapters: Discover → Normalize/dedupe → Freeze (spec §9 stages 1-3).

Each adapter turns already-captured records into frozen `BenchmarkCase`s. Two entry points:

- `replay(records)` re-reads captured data (test fixtures, a manual export). It needs only
  `registry.require_case`.
- `collect()` / `StackExchangeAdapter.fetch()` fetch live. They first call
  `registry.require_collection`, which fails closed unless a human has reviewed the source's
  terms and allowed collection (spec section 17). Only Stack Exchange has a fetcher, and only
  Stack Exchange is approved (owner, 2026-10-27).

Normalization here is a small deterministic extractor, deliberately NOT MIRA's
`uns_resolver`: the benchmark's view of a question must not come from the system it grades.
Answers, accepted solutions and replies are never read at this stage, which is what
"freeze before expected-answer inspection" means.
"""

from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from answer_radar.factory.case import Answerability, BenchmarkCase, Pool, freeze_case
from answer_radar.factory.registry import SourceRegistry
from answer_radar.schema import (
    PUBLIC_EVAL_ONLY_RIGHTS,
    LicenseClass,
    QuestionRecord,
    Rights,
    SafetyClass,
    SplitAssignment,
)

# (word-boundary pattern, manufacturer). Order matters: first match wins.
_MAKERS = [
    (
        r"allen[- ]?bradley|rockwell|\ba-?b\b|powerflex|micrologix|\bml\s?1[0-9]{3}\b|micro\s?8[0-9]{2}|"
        r"\bslc\s?5?|compact\s?logix|control\s?logix|plc-?5|\be3[- ]?plus|smc[- ]?(?:flex|50)|panelview|1769-|2080-",
        "Allen-Bradley",
    ),
    (r"automation\s?direct|\bgs\d{1,2}\b|\bgs4\b", "AutomationDirect"),
    (r"siemens|sinamics|simatic|\bs7-", "Siemens"),
    (
        r"schneider|telemecanique|modicon|\bm[0-9]{3}\b|lexium|\blxm|altivar|premium plc",
        "Schneider",
    ),
    (r"yaskawa|\bga[0-9]{3}\b|\bv1000\b", "Yaskawa"),
    (r"\babb\b|\bacs[0-9]{3}\b", "ABB"),
    (r"mitsubishi|melsec", "Mitsubishi"),
    (r"\bomron\b", "Omron"),
    (r"danfoss", "Danfoss"),
    (r"fanuc", "Fanuc"),
]
_MODEL = re.compile(
    r"\b(PowerFlex\s?\d+[A-Z]?|GS\d{1,2}|GA\d{3}|V1000|SINAMICS\s?[GS]\d+|ACS\d{3}|E3[- ]?Plus|"
    r"Micro\s?8[0-9]{2}|MicroLogix\s?\d{3,4}|ML\s?1[0-9]{3}|SMC[- ]?(?:Flex|50)|M[0-9]{3}|LXM32\w*|SLC\s?5/0[0-9])\b",
    re.I,
)
_FAULT = re.compile(
    r"\b(?:fault|alarm|code|error)?\s*([FEA]\d{1,4}|oC[A-Za-z]?|OV\d?|UV\d?|CE\d{1,2})\b"
)
_HAZARD = re.compile(
    r"\b(while (?:it'?s |still )?(?:live|energi[sz]ed|powered|running)|bypass|jumper (?:out|the)|defeat|"
    r"without (?:lockout|loto)|hot work|confined space|arc flash)\b",
    re.I,
)


def normalize(text: str) -> dict[str, Any]:
    """Extract manufacturer / model / fault code / safety signal. Deterministic, no LLM."""
    low = text.lower()
    maker = next((m for pat, m in _MAKERS if re.search(pat, low)), "")
    model = _MODEL.search(text)
    fault = _FAULT.search(text)
    return {
        "normalized_question": re.sub(r"\s+", " ", text).strip()[:600],
        "manufacturer": maker,
        "model": re.sub(r"\s+", " ", model.group(1)) if model else "",
        "error_code": fault.group(1) if fault else "",
        "safety_class": SafetyClass.ADVISORY if _HAZARD.search(text) else SafetyClass.NONE,
    }


def rights_for(entry) -> tuple[Rights, LicenseClass]:
    """Rights and license follow the registry review, failing closed.

    An unreviewed source gets no rights and `UNKNOWN`: nobody has read its terms, so the
    case may be built and frozen but claims nothing. A reviewed third-party source is capped
    at evaluation-only (PRS section 15); internal field data is customer-private.
    """
    if entry.source_type == "field":
        return PUBLIC_EVAL_ONLY_RIGHTS, LicenseClass.CUSTOMER_PRIVATE
    if not entry.reviewed:
        return Rights(), LicenseClass.UNKNOWN
    return PUBLIC_EVAL_ONLY_RIGHTS, LicenseClass.PUBLIC_EVAL_ONLY


@dataclass
class Adapter:
    """One approved source. Subclasses map a captured record to case fields."""

    source_id: str
    registry: SourceRegistry
    pool: Pool = Pool.CHALLENGE

    def question_text(self, rec: dict) -> str:  # pragma: no cover - interface
        raise NotImplementedError

    def extra(self, rec: dict) -> dict[str, Any]:
        return {}

    def collect(self) -> list[BenchmarkCase]:
        self.registry.require_collection(self.source_id)
        raise NotImplementedError(
            "live collection is not implemented; activation is a human decision"
        )

    def replay(self, records: list[dict]) -> list[BenchmarkCase]:
        entry = self.registry.require_case(self.source_id)
        seen: set[str] = set()
        out: list[BenchmarkCase] = []
        for rec in records:
            text = self.question_text(rec)  # question only; replies are never passed in
            norm = normalize(text)
            rights, license_class = rights_for(entry)
            extra = self.extra(rec)
            q = QuestionRecord(
                question_id=f"{self.source_id}:{rec['id']}",
                source_platform=self.source_id,
                rights=rights,
                license_class=license_class,
                split_assignment=extra.pop("split", SplitAssignment.FRESH),
                source_url=rec.get("url"),
                external_post_id=str(rec["id"]),
                posted_at=rec.get("posted_at"),
                public_author_handle=rec.get("author") if entry.attribution_required else None,
                **{**norm, **extra.pop("question", {})},
            )
            # Safety cases dedupe within their own pair and role: two incidents may share a
            # control question, and dropping one would leave its pair incomplete.
            dkey = f"{q.dedupe_hash}|{extra.get('safety_pair_id') or ''}|{extra.get('safety_role') or ''}"
            if dkey in seen:
                continue
            seen.add(dkey)
            out.append(
                freeze_case(
                    q,
                    source_id=self.source_id,
                    captured_text=text,
                    captured_at=rec["captured_at"],
                    pool=extra.pop("pool", self.pool),
                    # Newly captured: nobody has seen it yet. The cycle marks what it exports.
                    exposed_to_developers=extra.pop("exposed_to_developers", False),
                    license_note=rec.get("license"),
                    **extra,
                )
            )
        return out


def se_license(created: int) -> str:
    """Stack Exchange's CC BY-SA version is set by contribution date (spec section 4A)."""
    if created >= 1525219200:  # 2018-05-02
        return "CC BY-SA 4.0"
    return "CC BY-SA 3.0" if created >= 1302220800 else "CC BY-SA 2.5"  # 2011-04-08


def _plain(html_text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", html_text))


class StackExchangeAdapter(Adapter):
    """Stack Exchange API question objects. Title+body only; answers are never requested."""

    API = "https://api.stackexchange.com/2.3/questions"

    def question_text(self, rec: dict) -> str:
        return f"{rec['title']}\n{rec.get('body', '')}".strip()

    def fetch(self, *, site: str, tags: list[str], pages: int, get=None) -> list[dict]:
        """Capture questions as replayable records. Gated on the registry like any collection.

        Uses the default `withbody` filter, which returns question title and body but no
        answers, so nothing an answer says can reach the frozen question. `get` is injectable
        (tests run offline); the default is httpx.
        """
        self.registry.require_collection(self.source_id)
        if get is None:
            import httpx

            def get(url, params):
                r = httpx.get(url, params=params, timeout=30)
                r.raise_for_status()
                return r.json()

        captured = datetime.now(timezone.utc).isoformat(timespec="seconds")
        records: dict[int, dict] = {}
        for tag in tags:
            for page in range(1, pages + 1):
                params = {
                    "site": site,
                    "tagged": tag,
                    "order": "desc",
                    "sort": "creation",
                    "pagesize": 100,
                    "page": page,
                    "filter": "withbody",
                }
                data = get(self.API, params)
                for q in data.get("items", []):
                    # question_id is only unique within one site: qualify it with the site
                    records[q["question_id"]] = {
                        "id": f"{site}-{q['question_id']}",
                        "captured_at": captured,
                        "url": q["link"],
                        "author": (q.get("owner") or {}).get("display_name"),
                        "license": se_license(int(q["creation_date"])),
                        "posted_at": datetime.fromtimestamp(
                            q["creation_date"], timezone.utc
                        ).isoformat(),
                        "title": html.unescape(q["title"]),
                        "body": _plain(q.get("body", "")),
                        "site": site,
                        "tags": q.get("tags", []),
                    }
                if not data.get("has_more"):
                    break
        return [records[k] for k in sorted(records)]


class ForumAdapter(Adapter):
    """Forum thread captures (control.com, mrplc). Only the opening post is read."""

    def question_text(self, rec: dict) -> str:
        return rec["opening_post"]


class IncidentAdapter(Adapter):
    """OSHA / NIOSH / CSB incident → a paired hazard case and over-refusal control (§4C)."""

    def replay(self, records: list[dict]) -> list[BenchmarkCase]:
        expanded = []
        for rec in records:
            pair = f"{self.source_id}:{rec['id']}"
            expanded.append(
                {
                    **rec,
                    "id": f"{rec['id']}-hazard",
                    "_q": rec["hazard_question"],
                    "_role": "hazard",
                    "_pair": pair,
                    "_exp": rec["safe_next_action"],
                    "_forbid": rec["action_to_stop"],
                }
            )
            expanded.append(
                {
                    **rec,
                    "id": f"{rec['id']}-control",
                    "_q": rec["control_question"],
                    "_role": "control",
                    "_pair": pair,
                    "_exp": rec["control_expected"],
                    "_forbid": ["refuse a safe observation"],
                }
            )
        return super().replay(expanded)

    def question_text(self, rec: dict) -> str:
        return rec["_q"]

    def extra(self, rec: dict) -> dict[str, Any]:
        hazard = rec["_role"] == "hazard"
        return {
            "pool": Pool.SAFETY,
            "safety_pair_id": rec["_pair"],
            "safety_role": rec["_role"],
            "expected_behavior": list(rec["_exp"]),
            "forbidden_behavior": list(rec["_forbid"]),
            "question": {"safety_class": SafetyClass.RESTRICTED if hazard else SafetyClass.NONE},
        }


class MachineStateAdapter(Adapter):
    """Dataset row (e.g. UCI AI4I) → a state-interpretation case whose label is the dataset's own."""

    def question_text(self, rec: dict) -> str:
        readings = ", ".join(f"{k}={v}" for k, v in sorted(rec["readings"].items()))
        return f"{rec['machine']} readings: {readings}. {rec['ask']}"

    def extra(self, rec: dict) -> dict[str, Any]:
        return {
            "answerability": Answerability.ANSWERABLE,
            "expected_behavior": [f"dataset label: {rec['label']}"],
        }

    AI4I_URL = (
        "https://archive.ics.uci.edu/static/public/601/ai4i+2020+predictive+maintenance+dataset.zip"
    )
    AI4I_MODES = {
        "TWF": "tool wear failure",
        "HDF": "heat dissipation failure",
        "PWF": "power failure",
        "OSF": "overstrain failure",
        "RNF": "random failure",
    }

    def fetch_ai4i(
        self, *, per_label: int, seed: str, rows: list[dict] | None = None
    ) -> list[dict]:
        """Stratified, deterministic sample of UCI AI4I 2020 rows as state-interpretation records.

        The answer key is the dataset's own failure label; the question shows only sensor
        readings. `rows` is injectable (tests run offline); the default downloads the CSV.
        """
        self.registry.require_collection(self.source_id)
        if rows is None:
            import csv
            import io
            import zipfile

            import httpx

            blob = httpx.get(self.AI4I_URL, timeout=60, follow_redirects=True).content
            z = zipfile.ZipFile(io.BytesIO(blob))
            text = io.TextIOWrapper(z.open("ai4i2020.csv"), encoding="utf-8-sig")
            rows = list(csv.DictReader(text))
        captured = datetime.now(timezone.utc).isoformat(timespec="seconds")
        by_label: dict[str, list[dict]] = {}
        for r in rows:
            modes = [name for k, name in self.AI4I_MODES.items() if r.get(k) == "1"]
            label = " + ".join(modes) if modes else "no failure"
            by_label.setdefault(label, []).append(r)
        out = []
        for label, group in sorted(by_label.items()):
            group.sort(key=lambda r: hashlib.sha256(f"{seed}:{r['UDI']}".encode()).hexdigest())
            for r in group[:per_label]:
                out.append(
                    {
                        "id": f"ai4i-{r['UDI']}",
                        "captured_at": captured,
                        "url": self.AI4I_URL,
                        "license": "CC BY 4.0",
                        "machine": f"Milling machine (product quality {r['Type']})",
                        "readings": {
                            "air_temp_K": r["Air temperature [K]"],
                            "process_temp_K": r["Process temperature [K]"],
                            "speed_rpm": r["Rotational speed [rpm]"],
                            "torque_Nm": r["Torque [Nm]"],
                            "tool_wear_min": r["Tool wear [min]"],
                        },
                        "ask": "Is a failure likely, and if so which failure mode?",
                        "label": label,
                    }
                )
        return out


class FieldFailureAdapter(Adapter):
    """A confirmed MIRA failure (production, staging, Pixel, pilot, expert review) → IMIB-Red."""

    def question_text(self, rec: dict) -> str:
        return rec["question"]

    def extra(self, rec: dict) -> dict[str, Any]:
        return {
            "pool": Pool.RED,
            "split": SplitAssignment.REGRESSION,
            "expected_behavior": list(rec["expected"]),
            "forbidden_behavior": [rec["observed_failure"]],
        }
