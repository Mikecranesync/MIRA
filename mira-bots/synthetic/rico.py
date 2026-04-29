"""
Rico Mendez — Night Shift Technician synthetic user.

Exercises the MIRA diagnostic flow + work order creation + PM completion.
Calls the running mira-pipeline HTTP endpoint (OpenAI-compat) so the full
FSM, RAG, and LLM cascade are exercised exactly as a real user would.

Pulls scenarios from the Reddit corpus for realism.
Records every observation to NeonDB synthetic_observations table.
Sends a Telegram shift summary when complete.

Usage:
    doppler run -- python3 mira-bots/synthetic/run_rico.py
"""
from __future__ import annotations

import json
import logging
import os
import random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("synthetic.rico")

# ── Paths ─────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).parent.resolve()
_REPO = _HERE.parent.parent
CORPUS_FILE = _REPO / "mira-bots" / "benchmarks" / "corpus" / "processed" / "questions.json"

# ── Rico's vocabulary fingerprint ─────────────────────────────────────────────
_RICO_TRANSFORMS = [
    ("i am experiencing", "getting"),
    ("the equipment is", "its"),
    ("could you please", "can you"),
    ("what is the", "whats the"),
    ("i have a", "got a"),
    ("the fault code is", "fault code"),
    ("i would like to", "wanna"),
    ("the machine", "machine"),
    ("the motor", "motor"),
    ("the drive", "drive"),
    ("displaying", "showing"),
    ("intermittently", "sometimes"),
    ("approximately", "about"),
    ("immediately", "right now"),
]

_RICO_OPENERS = [
    "hey ",
    "yo ",
    "",
    "quick q — ",
    "need help — ",
]

_RICO_TYPOS = {
    "fault": "faul",
    "drive": "drvie",
    "motor": "mtor",
    "error": "eror",
    "panel": "pnel",
    "voltage": "voltge",
}


# ── Mira HTTP client (calls mira-pipeline:9099) ────────────────────────────────

class MiraClient:
    """Thin HTTP wrapper around the running mira-pipeline /v1/chat/completions."""

    def __init__(
        self,
        base_url: str = "",
        api_key: str = "",
        chat_id: str = "",
    ) -> None:
        self.base_url = base_url or os.environ.get("MIRA_PIPELINE_URL", "http://localhost:9099")
        self.api_key = api_key or os.environ.get("PIPELINE_API_KEY", "")
        self.chat_id = chat_id

    def chat(self, message: str) -> dict[str, Any]:
        """Send one message to MIRA. Returns {"reply": str, "raw": dict}."""
        t0 = time.monotonic()
        payload = json.dumps({
            "model": "mira-diagnostic",
            "messages": [{"role": "user", "content": message}],
            "user": self.chat_id,
        }).encode("utf-8")

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        req = urllib.request.Request(
            f"{self.base_url}/v1/chat/completions",
            data=payload,
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
                reply = raw["choices"][0]["message"]["content"]
                latency_ms = int((time.monotonic() - t0) * 1000)
                return {"reply": reply, "raw": raw, "latency_ms": latency_ms, "success": True}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")[:200]
            logger.error("MiraClient HTTP %d: %s", exc.code, body)
            return {"reply": "", "raw": {}, "latency_ms": int((time.monotonic() - t0) * 1000), "success": False, "error": body}
        except Exception as exc:
            logger.error("MiraClient error: %s", exc)
            return {"reply": "", "raw": {}, "latency_ms": 0, "success": False, "error": str(exc)}


# ── Hub / Atlas CMMS client ────────────────────────────────────────────────────

class HubClient:
    """REST client for Atlas CMMS. Degrades gracefully when Atlas is not running."""

    def __init__(self, base_url: str = "", auth: tuple[str, str] | None = None) -> None:
        self.base_url = base_url or os.environ.get("ATLAS_API_URL", "http://localhost:8088")
        _user = os.environ.get("PLG_ATLAS_ADMIN_USER", "admin")
        _pass = os.environ.get("PLG_ATLAS_ADMIN_PASSWORD", "factorylm")
        self.auth = auth or (_user, _pass)

    def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        import base64
        url = f"{self.base_url}{path}"
        token = base64.b64encode(f"{self.auth[0]}:{self.auth[1]}".encode()).decode()
        headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }
        data = json.dumps(body).encode("utf-8") if body else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            logger.debug("HubClient %s %s failed: %s", method, path, exc)
            return None

    def get_pm_schedules(self, status: str = "due") -> list[dict]:
        result = self._request("GET", f"/api/pm-schedules?status={status}")
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "content" in result:
            return result["content"]
        return []

    def update_pm(self, pm_id: str, status: str) -> bool:
        result = self._request("PATCH", f"/api/pm-schedules/{pm_id}", {"status": status})
        return result is not None

    def create_work_order(self, title: str, description: str, priority: str = "medium") -> dict | None:
        return self._request("POST", "/api/work-orders", {
            "title": title,
            "description": description,
            "priority": priority,
            "status": "open",
            "source": "synthetic_rico",
        })


# ── NeonDB observation recorder ───────────────────────────────────────────────

class NeonRecorder:
    """Writes observations to synthetic_observations table in NeonDB."""

    def __init__(self, dsn: str = "") -> None:
        self.dsn = dsn or os.environ.get("NEON_DATABASE_URL", "")
        self._conn = None

    def _get_conn(self):
        if self._conn is None and self.dsn:
            try:
                import psycopg2
                self._conn = psycopg2.connect(self.dsn)
                self._conn.autocommit = True
            except Exception as exc:
                logger.warning("NeonRecorder connect failed: %s", exc)
        return self._conn

    def record(
        self,
        agent_name: str,
        channel: str,
        action: str,
        request: str,
        response: str,
        latency_ms: int = 0,
        success: bool = True,
        quality_signals: dict | None = None,
    ) -> None:
        conn = self._get_conn()
        if conn is None:
            logger.debug("NeonRecorder: no DB connection, observation dropped")
            return
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO synthetic_observations
                    (agent_name, channel, action, request, response,
                     latency_ms, success, quality_signals)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    agent_name, channel, action,
                    request[:2000], response[:2000],
                    latency_ms, success,
                    json.dumps(quality_signals or {}),
                ),
            )
            cur.close()
        except Exception as exc:
            logger.warning("NeonRecorder write failed: %s", exc)

    def close(self) -> None:
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None


# ── Telegram notify (stdlib-only, no httpx needed) ────────────────────────────

def _tg_send(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "8445149012")
    if not token:
        return False
    payload = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status == 200
    except Exception as exc:
        logger.warning("Telegram send failed: %s", exc)
        return False


# ── Scenario picker ───────────────────────────────────────────────────────────

_EQUIPMENT_KEYWORDS = {"vfd", "drive", "motor", "pump", "conveyor", "panel", "plc", "inverter"}


def load_scenarios(path: Path = CORPUS_FILE) -> list[dict]:
    """Load quality-passing industrial questions from the corpus."""
    if not path.exists():
        logger.warning("Corpus not found at %s — using built-in fallback", path)
        return _FALLBACK_SCENARIOS

    questions = json.loads(path.read_text())
    industrial = [
        q for q in questions
        if q.get("quality_pass") and (
            q.get("category") in ("electrical", "mechanical", "industrial", "plc", "hvac")
            or any(kw in (q.get("title", "") + q.get("selftext", "")).lower()
                   for kw in _EQUIPMENT_KEYWORDS)
        )
    ]
    return industrial or _FALLBACK_SCENARIOS


_FALLBACK_SCENARIOS = [
    {
        "title": "VFD throwing F005 fault code",
        "selftext": "My Allen-Bradley PowerFlex drive is throwing fault F005 repeatedly. It happens when the motor ramps up to about 60Hz. Checked the load and it seems fine.",
        "equipment_type": "VFD",
        "fault_codes": ["F005"],
        "manufacturer": "Allen-Bradley",
    },
    {
        "title": "Motor tripping on overload every morning",
        "selftext": "Our pump motor trips the overload relay every morning on startup. It runs fine after reset. This has been happening for two weeks.",
        "equipment_type": "motor",
        "fault_codes": [],
        "manufacturer": "Siemens",
    },
    {
        "title": "Conveyor keeps e-stopping randomly",
        "selftext": "Line 3 conveyor keeps throwing an e-stop fault. No obvious reason. Belt looks okay. Happens maybe once per shift.",
        "equipment_type": "conveyor",
        "fault_codes": ["E-STOP"],
        "manufacturer": "unknown",
    },
]


# ── Rico Mendez ───────────────────────────────────────────────────────────────

@dataclass
class ShiftResult:
    scenario: dict
    messages: list[dict] = field(default_factory=list)
    pm_completed: bool = False
    wo_created: bool = False
    mira_responded: bool = False
    fsm_advanced: bool = False
    observations_recorded: int = 0
    telegram_sent: bool = False
    error: str | None = None


class Rico:
    """Rico Mendez — Night Shift Technician.

    Runs a realistic shift simulation: check PMs, encounter a fault,
    query MIRA, follow up, create a work order, report to Mike.
    """

    NAME = "Rico Mendez"
    ROLE = "night_shift_technician"
    SHIFT_LABEL = "night (22:00–06:00 ET)"

    def __init__(
        self,
        mira: MiraClient | None = None,
        hub: HubClient | None = None,
        recorder: NeonRecorder | None = None,
    ) -> None:
        self.session_id = f"synthetic_rico_{int(time.time())}"
        self.mira = mira or MiraClient(chat_id=self.session_id)
        self.hub = hub or HubClient()
        self.recorder = recorder or NeonRecorder()
        self.scenarios = load_scenarios()

    # ── Rico's voice ──────────────────────────────────────────────────────────

    def _rephrase(self, text: str) -> str:
        """Rephrase a corpus question in Rico's voice."""
        msg = text.lower().strip()

        # Apply vocabulary transforms
        for formal, casual in _RICO_TRANSFORMS:
            msg = msg.replace(formal, casual)

        # Occasional typo (20% chance per word)
        if random.random() < 0.25:
            words = msg.split()
            if len(words) > 3:
                idx = random.randint(1, len(words) - 1)
                word = words[idx]
                if word in _RICO_TYPOS:
                    words[idx] = _RICO_TYPOS[word]
                elif len(word) > 4:
                    # Swap two adjacent chars
                    i = random.randint(1, len(word) - 2)
                    words[idx] = word[:i] + word[i + 1] + word[i] + word[i + 2:]
                msg = " ".join(words)

        # Prepend opener
        opener = random.choice(_RICO_OPENERS)
        msg = opener + msg

        # Truncate like someone texting with gloves
        if len(msg) > 160:
            msg = msg[:157] + "..."

        return msg

    def _pick_scenario(self) -> dict:
        return random.choice(self.scenarios)

    def _generate_follow_up(self, mira_reply: str, scenario: dict) -> str:
        """Generate a plausible Rico follow-up when MIRA asks a question."""
        reply_lower = mira_reply.lower()

        if "voltage" in reply_lower:
            return random.choice(["checked it, reads 480v", "yeah voltage looks normal", "its at spec"])
        if "temperature" in reply_lower or "heat" in reply_lower or "temp" in reply_lower:
            return random.choice(["panel feels hot actually", "normal temp i think", "no alarm on temp"])
        if "load" in reply_lower or "amps" in reply_lower:
            return random.choice(["running about 80% load", "amp draw looks ok", "full load yeah"])
        if "reset" in reply_lower:
            return "already tried reset, comes back"
        if "error" in reply_lower or "fault" in reply_lower or "code" in reply_lower:
            codes = scenario.get("fault_codes", [])
            if codes:
                return f"yeah the code showing is {codes[0]}"
            return "just says fault on the display"
        if "history" in reply_lower or "how long" in reply_lower or "when" in reply_lower:
            return random.choice(["started yesterday", "been happening for like a week", "just started tonight"])

        return random.choice([
            "yeah thats right",
            "correct",
            "yep",
            "thats what im seeing",
            "makes sense",
        ])

    # ── Observation recording ─────────────────────────────────────────────────

    def _record(
        self, action: str, request: str, response: str,
        latency_ms: int = 0, success: bool = True, quality: dict | None = None,
    ) -> None:
        self.recorder.record(
            agent_name=self.NAME,
            channel="mira_pipeline",
            action=action,
            request=request,
            response=response,
            latency_ms=latency_ms,
            success=success,
            quality_signals=quality or {},
        )

    # ── Main shift simulation ─────────────────────────────────────────────────

    def run_shift(self) -> ShiftResult:
        scenario = self._pick_scenario()
        result = ShiftResult(scenario=scenario)

        equipment = scenario.get("equipment_type", "equipment")
        fault_codes = scenario.get("fault_codes", [])
        fault_str = fault_codes[0] if fault_codes else "unknown fault"

        logger.info("Rico clocking in — scenario: %s %s", equipment, fault_str)

        # ── 1. Check PM schedule ──────────────────────────────────────────────
        pms = self.hub.get_pm_schedules(status="due")
        _tg_send(
            f"🔧 *Rico Mendez* — Clocking in\n"
            f"Session: `{self.session_id}`\n"
            f"{len(pms)} PM(s) due tonight · Scenario: {equipment} {fault_str}"
        )

        # ── 2. Complete a PM (if available) ──────────────────────────────────
        if pms:
            pm = pms[0]
            pm_id = pm.get("id", "")
            pm_title = pm.get("title", "scheduled PM")
            if pm_id:
                self.hub.update_pm(pm_id, "in_progress")
                time.sleep(1)
                ok = self.hub.update_pm(pm_id, "completed")
                if ok:
                    result.pm_completed = True
                    self._record("pm_complete", pm_title, "completed", success=True)
                    logger.info("Rico completed PM: %s", pm_title)
        else:
            logger.info("No PMs due — Rico goes straight to fault scenario")

        # ── 3. Build Rico's fault question ────────────────────────────────────
        raw_question = scenario.get("selftext") or scenario.get("title", "")
        if not raw_question:
            raw_question = f"getting a {fault_str} fault on the {equipment}, what do i do"

        rico_msg = self._rephrase(raw_question)
        logger.info("Rico asks MIRA: %s", rico_msg)

        # ── 4. First MIRA turn ────────────────────────────────────────────────
        resp = self.mira.chat(rico_msg)
        result.messages.append({"from": "rico", "text": rico_msg})
        result.messages.append({"from": "mira", "text": resp.get("reply", ""), "latency_ms": resp.get("latency_ms", 0)})

        self._record(
            "mira_chat", rico_msg, resp.get("reply", ""),
            latency_ms=resp.get("latency_ms", 0),
            success=resp.get("success", False),
            quality={"has_reply": bool(resp.get("reply")), "scenario_equipment": equipment},
        )

        if resp.get("success") and resp.get("reply"):
            result.mira_responded = True

        # ── 5. Follow-up turns (max 3) ────────────────────────────────────────
        current_reply = resp.get("reply", "")
        for turn in range(3):
            if "?" not in current_reply or not resp.get("success"):
                break

            follow_up = self._generate_follow_up(current_reply, scenario)
            logger.info("Rico follow-up %d: %s", turn + 1, follow_up)
            resp = self.mira.chat(follow_up)

            result.messages.append({"from": "rico", "text": follow_up})
            result.messages.append({"from": "mira", "text": resp.get("reply", ""), "latency_ms": resp.get("latency_ms", 0)})

            self._record(
                "mira_followup", follow_up, resp.get("reply", ""),
                latency_ms=resp.get("latency_ms", 0),
                success=resp.get("success", False),
                quality={"turn": turn + 1, "had_question": True},
            )
            current_reply = resp.get("reply", "")

            # Small delay between turns — realistic
            time.sleep(0.5)

        # ── 6. FSM advance check ──────────────────────────────────────────────
        # If MIRA gave a substantive reply (not just a question), FSM likely advanced
        final_reply = current_reply or ""
        result.fsm_advanced = len(final_reply) > 50 and "?" not in final_reply[:50]

        # ── 7. Work order creation ────────────────────────────────────────────
        if "work order" in final_reply.lower() or random.random() < 0.4:
            wo_msg = "yes log it"
            resp = self.mira.chat(wo_msg)
            result.messages.append({"from": "rico", "text": wo_msg})
            result.messages.append({"from": "mira", "text": resp.get("reply", "")})

            self._record(
                "wo_request", wo_msg, resp.get("reply", ""),
                latency_ms=resp.get("latency_ms", 0),
                success=resp.get("success", False),
                quality={"wo_trigger": "voice"},
            )

            # Also hit the Hub API directly
            wo = self.hub.create_work_order(
                title=f"{equipment.title()} fault — {fault_str}",
                description=rico_msg,
                priority="medium",
            )
            if wo:
                result.wo_created = True
                self._record("hub_wo_create", rico_msg, json.dumps(wo), success=True)

        # ── 8. Count observations ─────────────────────────────────────────────
        result.observations_recorded = len(result.messages) // 2

        # ── 9. Shift report to Mike ───────────────────────────────────────────
        turns = sum(1 for m in result.messages if m["from"] == "rico")
        mira_replies = [m["text"] for m in result.messages if m["from"] == "mira" and m["text"]]
        avg_latency = int(
            sum(m.get("latency_ms", 0) for m in result.messages if m.get("latency_ms"))
            / max(len(mira_replies), 1)
        )

        report = (
            f"🔧 *Rico Mendez — Shift Complete*\n\n"
            f"*Scenario:* {equipment} — `{fault_str}`\n"
            f"*Turns:* {turns} messages sent\n"
            f"*MIRA responded:* {'✅' if result.mira_responded else '❌'}\n"
            f"*FSM advanced:* {'✅' if result.fsm_advanced else '⚠️ unclear'}\n"
            f"*PM completed:* {'✅' if result.pm_completed else 'none due'}\n"
            f"*WO created:* {'✅' if result.wo_created else '—'}\n"
            f"*Avg latency:* {avg_latency}ms\n"
            f"*Observations:* {result.observations_recorded} recorded\n\n"
            f"*Last MIRA reply:*\n_{mira_replies[-1][:200] if mira_replies else 'no response'}_"
        )
        result.telegram_sent = _tg_send(report)

        self.recorder.close()
        return result


# ── Convenience runner ────────────────────────────────────────────────────────

def run_one_shift(verbose: bool = True) -> ShiftResult:
    """Instantiate Rico and run one full shift. Returns the result."""
    rico = Rico()
    result = rico.run_shift()
    if verbose:
        _print_shift_report(result)
    return result


def _print_shift_report(r: ShiftResult) -> None:
    scenario = r.scenario
    print("\n" + "=" * 60)
    print("RICO MENDEZ — SHIFT REPORT")
    print("=" * 60)
    print(f"Scenario:   {scenario.get('equipment_type', '?')} / {scenario.get('fault_codes', ['?'])[0] if scenario.get('fault_codes') else 'no fault code'}")
    print(f"Turns:      {sum(1 for m in r.messages if m['from'] == 'rico')} sent")
    print(f"MIRA:       {'responded' if r.mira_responded else 'NO RESPONSE — CHECK ENGINE'}")
    print(f"FSM:        {'advanced' if r.fsm_advanced else 'unclear / still in Q phase'}")
    print(f"PM:         {'completed' if r.pm_completed else 'none due'}")
    print(f"WO:         {'created' if r.wo_created else 'not needed'}")
    print(f"Telegram:   {'sent' if r.telegram_sent else 'FAILED'}")
    print(f"Obs:        {r.observations_recorded} recorded to NeonDB")
    print()
    print("CONVERSATION:")
    for msg in r.messages:
        who = "Rico " if msg["from"] == "rico" else "MIRA  "
        latency = f" [{msg.get('latency_ms', 0)}ms]" if msg.get("latency_ms") else ""
        print(f"  {who}: {msg['text'][:120]}{latency}")
    print("=" * 60)
