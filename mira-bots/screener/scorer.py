"""Conversation quality scorer.

Consumes TurnQuality events, buffers per chat_id, detects quality flags,
and emits SessionQuality when a session completes or a P0 flag fires live.

Quality flag taxonomy:
  P0: FSM_LOOP, THUMBS_DOWN, HALLUCINATION_RISK
  P1: LOW_CONFIDENCE_PERSISTENT, ABANDONED, REPETITION, MISSING_SLOTS
  P2: HIGH_LATENCY, INTENT_MISMATCH, LOW_JUDGE_SCORE
"""

from __future__ import annotations

import difflib
import logging
import re
from datetime import datetime, timedelta, timezone

from .schema import (
    CONFIDENCE_MAP,
    FSM_LOOP_THRESHOLD,
    HALLUCINATION_FAST_THRESHOLD_MS,
    LATENCY_P95_THRESHOLD_MS,
    LOW_CONFIDENCE_TURN_RATIO,
    MISSING_SLOTS_MIN_EXCHANGES,
    REPETITION_RATIO,
    QualityFlag,
    SessionQuality,
    TurnQuality,
)

logger = logging.getLogger("mira-screener")

_NEGATION_RE = re.compile(r"^(no|not|wrong|nope|stop|that'?s not|incorrect)", re.IGNORECASE)
_FRUSTRATION_SHORT_LEN = 10
_SESSION_TIMEOUT_MINUTES = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_turn(row: dict, turn_id: int) -> TurnQuality:
    """Build a TurnQuality from a raw SQLite interactions row."""
    ts_str = row.get("created_at", "")
    try:
        ts = datetime.fromisoformat(ts_str)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
    except Exception:
        ts = _now()

    conf_raw = (row.get("confidence") or "").lower()
    return TurnQuality(
        turn_id=turn_id,
        chat_id=str(row.get("chat_id", "")),
        timestamp=ts,
        user_message=row.get("user_message", ""),
        bot_response=row.get("bot_response", ""),
        fsm_state=row.get("fsm_state", ""),
        intent=row.get("intent", ""),
        confidence_raw=conf_raw,
        confidence_numeric=CONFIDENCE_MAP.get(conf_raw, 0.1),
        response_time_ms=int(row.get("response_time_ms") or 0),
        has_photo=bool(row.get("has_photo", 0)),
    )


def _similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _p95(values: list[int]) -> int:
    if not values:
        return 0
    sorted_v = sorted(values)
    idx = max(0, int(len(sorted_v) * 0.95) - 1)
    return sorted_v[idx]


class Scorer:
    """Stateful per-session quality scorer.

    Call ingest_sqlite_row() for each new interactions row.
    Call ingest_feedback() when a feedback_log row arrives.
    Returns SessionQuality (or None) — non-None means the session is ready.
    """

    def __init__(self) -> None:
        # chat_id → buffered TurnQuality list
        self._sessions: dict[str, list[TurnQuality]] = {}
        # chat_id → last event timestamp (for timeout detection)
        self._last_event: dict[str, datetime] = {}
        # chat_id → feedback rating from feedback_log
        self._feedback: dict[str, str] = {}
        # running turn id counter (SQLite id is preferred when available)
        self._turn_counter = 0

    def ingest_sqlite_row(self, row: dict) -> SessionQuality | None:
        """Process a new interactions table row. Returns scored session if P0 fires."""
        self._turn_counter += 1
        turn = _to_turn(row, row.get("id", self._turn_counter))
        return self._ingest_turn(turn)

    def ingest_ndjson_event(self, event: dict) -> SessionQuality | None:
        """Process a turn or feedback event from an NDJSON session file."""
        if event.get("type") == "feedback":
            chat_id = str(event.get("chat_id", ""))
            rating = event.get("feedback_rating", "")
            if chat_id and rating:
                self._feedback[chat_id] = rating
                # Trigger immediate score if we have buffered turns
                if chat_id in self._sessions and self._sessions[chat_id]:
                    return self._score_session(chat_id)
            return None

        # Regular diagnostic turn from NDJSON
        ts_str = event.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            ts = _now()

        conf_raw = (event.get("confidence") or "").lower()
        self._turn_counter += 1
        turn = TurnQuality(
            turn_id=self._turn_counter,
            chat_id=str(event.get("chat_id", "")),
            timestamp=ts,
            user_message=event.get("user_message", ""),
            bot_response=event.get("bot_response", ""),
            fsm_state=event.get("fsm_state", ""),
            intent=event.get("intent", ""),
            confidence_raw=conf_raw,
            confidence_numeric=CONFIDENCE_MAP.get(conf_raw, 0.1),
            response_time_ms=int(event.get("response_time_ms") or 0),
            has_photo=bool(event.get("has_photo", False)),
        )
        return self._ingest_turn(turn)

    def ingest_feedback(self, row: dict) -> SessionQuality | None:
        """Process a feedback_log row. Triggers immediate session scoring."""
        chat_id = str(row.get("chat_id", ""))
        rating = row.get("feedback", "")
        if not chat_id:
            return None
        self._feedback[chat_id] = rating
        if chat_id in self._sessions and self._sessions[chat_id]:
            return self._score_session(chat_id)
        return None

    def flush_timedout_sessions(self) -> list[SessionQuality]:
        """Score and flush sessions that have been idle for >10 minutes."""
        now = _now()
        cutoff = now - timedelta(minutes=_SESSION_TIMEOUT_MINUTES)
        ready = []
        for chat_id, last_ts in list(self._last_event.items()):
            if last_ts < cutoff and chat_id in self._sessions:
                result = self._score_session(chat_id)
                if result:
                    ready.append(result)
        return ready

    def _ingest_turn(self, turn: TurnQuality) -> SessionQuality | None:
        chat_id = turn.chat_id
        if not chat_id:
            return None

        self._last_event[chat_id] = turn.timestamp

        if chat_id not in self._sessions:
            self._sessions[chat_id] = []

        turns = self._sessions[chat_id]

        # Compute derived signals before appending
        if turns:
            prev_user = turns[-1].user_message
            turn.repetition_detected = _similarity(turn.user_message, prev_user) >= REPETITION_RATIO
            prev_was_bot_question = turns[-1].bot_response.strip().endswith("?")
            turn.frustration_signal = (
                prev_was_bot_question
                and (
                    len(turn.user_message) < _FRUSTRATION_SHORT_LEN
                    or bool(_NEGATION_RE.match(turn.user_message))
                )
            )
            turn.fsm_advanced = turns[-1].fsm_state != turn.fsm_state
        else:
            turn.fsm_advanced = True

        turns.append(turn)

        # Check for P0 conditions — emit immediately without waiting for session end
        p0_flags = self._check_p0_live(turns)
        if p0_flags:
            return self._score_session(chat_id)

        # Normal session completion: RESOLVED state
        if turn.fsm_state == "RESOLVED":
            return self._score_session(chat_id)

        return None

    def _check_p0_live(self, turns: list[TurnQuality]) -> list[QualityFlag]:
        """Check only P0 conditions that should fire immediately during a live session."""
        flags: list[QualityFlag] = []

        # FSM_LOOP: same state >= FSM_LOOP_THRESHOLD consecutive turns
        if len(turns) >= FSM_LOOP_THRESHOLD:
            tail = turns[-FSM_LOOP_THRESHOLD:]
            states = [t.fsm_state for t in tail]
            if len(set(states)) == 1 and states[0] not in ("IDLE", "RESOLVED", ""):
                flags.append(QualityFlag(
                    code="FSM_LOOP",
                    severity="P0",
                    description=f"FSM stuck in '{states[0]}' for {FSM_LOOP_THRESHOLD}+ consecutive turns",
                    turns_affected=[t.turn_id for t in tail],
                ))

        # HALLUCINATION_RISK: none confidence + very fast response (no RAG hit)
        last = turns[-1]
        if (
            last.confidence_raw in ("none", "")
            and last.response_time_ms > 0
            and last.response_time_ms < HALLUCINATION_FAST_THRESHOLD_MS
        ):
            flags.append(QualityFlag(
                code="HALLUCINATION_RISK",
                severity="P0",
                description=(
                    f"Response in {last.response_time_ms}ms with confidence=none "
                    f"— likely no RAG hit, possible hallucination"
                ),
                turns_affected=[last.turn_id],
            ))

        return flags

    def _detect_all_flags(
        self, turns: list[TurnQuality], feedback_rating: str | None
    ) -> list[QualityFlag]:
        """Detect all 10 quality flags for a complete session."""
        flags: list[QualityFlag] = []
        if not turns:
            return flags

        latencies = [t.response_time_ms for t in turns if t.response_time_ms > 0]
        low_conf_turns = [t for t in turns if t.confidence_raw in ("low", "none", "")]
        repeated_turns = [t for t in turns if t.repetition_detected]

        last_state = turns[-1].fsm_state

        # ── P0 ──────────────────────────────────────────────────────────────
        # FSM_LOOP
        for i in range(len(turns) - FSM_LOOP_THRESHOLD + 1):
            window = turns[i:i + FSM_LOOP_THRESHOLD]
            states = [t.fsm_state for t in window]
            if len(set(states)) == 1 and states[0] not in ("IDLE", "RESOLVED", ""):
                flags.append(QualityFlag(
                    code="FSM_LOOP",
                    severity="P0",
                    description=f"FSM stuck in '{states[0]}' for {FSM_LOOP_THRESHOLD}+ turns",
                    turns_affected=[t.turn_id for t in window],
                ))
                break  # one flag per session

        # THUMBS_DOWN (covers both feedback_log "negative" and NDJSON "thumbs_down")
        if feedback_rating and feedback_rating.lower() in ("negative", "thumbs_down"):
            flags.append(QualityFlag(
                code="THUMBS_DOWN",
                severity="P0",
                description=f"User submitted negative feedback: '{feedback_rating}'",
                turns_affected=[t.turn_id for t in turns],
            ))

        # HALLUCINATION_RISK
        for t in turns:
            if (
                t.confidence_raw in ("none", "")
                and t.response_time_ms > 0
                and t.response_time_ms < HALLUCINATION_FAST_THRESHOLD_MS
            ):
                flags.append(QualityFlag(
                    code="HALLUCINATION_RISK",
                    severity="P0",
                    description=(
                        f"Turn {t.turn_id}: {t.response_time_ms}ms response, "
                        f"confidence=none — no RAG hit likely"
                    ),
                    turns_affected=[t.turn_id],
                ))
                break

        # ── P1 ──────────────────────────────────────────────────────────────
        # LOW_CONFIDENCE_PERSISTENT
        if len(turns) > 0:
            ratio = len(low_conf_turns) / len(turns)
            if ratio > LOW_CONFIDENCE_TURN_RATIO:
                flags.append(QualityFlag(
                    code="LOW_CONFIDENCE_PERSISTENT",
                    severity="P1",
                    description=(
                        f"{len(low_conf_turns)}/{len(turns)} turns have low/none confidence "
                        f"({ratio:.0%})"
                    ),
                    turns_affected=[t.turn_id for t in low_conf_turns],
                ))

        # ABANDONED
        if last_state not in ("RESOLVED",) and feedback_rating not in ("positive", "thumbs_up"):
            if len(turns) >= 2:
                flags.append(QualityFlag(
                    code="ABANDONED",
                    severity="P1",
                    description=f"Session ended in '{last_state}' without reaching RESOLVED",
                    turns_affected=[turns[-1].turn_id],
                ))

        # REPETITION
        if len(repeated_turns) >= 2:
            flags.append(QualityFlag(
                code="REPETITION",
                severity="P1",
                description=f"User repeated themselves {len(repeated_turns)} times",
                turns_affected=[t.turn_id for t in repeated_turns],
            ))

        # MISSING_SLOTS: check via last few user messages — asset not identified after N exchanges
        # We infer this from the FSM not reaching ASSET_IDENTIFIED or DIAGNOSIS
        advanced_states = {"ASSET_IDENTIFIED", "ELECTRICAL_PRINT", "DIAGNOSIS", "FIX_STEP", "RESOLVED"}
        if len(turns) >= MISSING_SLOTS_MIN_EXCHANGES:
            reached_advanced = any(t.fsm_state in advanced_states for t in turns)
            if not reached_advanced:
                flags.append(QualityFlag(
                    code="MISSING_SLOTS",
                    severity="P1",
                    description=(
                        f"{len(turns)} exchanges without reaching asset identification "
                        f"or diagnosis state"
                    ),
                    turns_affected=[t.turn_id for t in turns[-3:]],
                ))

        # ── P2 ──────────────────────────────────────────────────────────────
        # HIGH_LATENCY
        if latencies:
            p95_val = _p95(latencies)
            if p95_val > LATENCY_P95_THRESHOLD_MS:
                slow_turns = [t for t in turns if t.response_time_ms > LATENCY_P95_THRESHOLD_MS]
                flags.append(QualityFlag(
                    code="HIGH_LATENCY",
                    severity="P2",
                    description=f"P95 response time {p95_val}ms exceeds {LATENCY_P95_THRESHOLD_MS}ms threshold",
                    turns_affected=[t.turn_id for t in slow_turns],
                ))

        # INTENT_MISMATCH: chitchat intent after exchange 2 in active diagnostic
        for t in turns:
            if t.turn_id > 2 and t.intent == "greeting_or_chitchat":
                if any(pt.fsm_state not in ("IDLE", "") for pt in turns[:turns.index(t)]):
                    flags.append(QualityFlag(
                        code="INTENT_MISMATCH",
                        severity="P2",
                        description=(
                            f"Turn {t.turn_id}: intent classified as 'greeting_or_chitchat' "
                            f"during active diagnostic session (state: {t.fsm_state})"
                        ),
                        turns_affected=[t.turn_id],
                    ))
                    break

        # LOW_JUDGE_SCORE is populated externally by the batch analyzer — skip here

        # Deduplicate: keep first occurrence of each code
        seen: set[str] = set()
        deduped: list[QualityFlag] = []
        for f in flags:
            if f.code not in seen:
                seen.add(f.code)
                deduped.append(f)

        # Sort by severity (P0 first)
        order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
        deduped.sort(key=lambda f: order.get(f.severity, 9))
        return deduped

    def _score_session(self, chat_id: str) -> SessionQuality | None:
        turns = self._sessions.pop(chat_id, [])
        self._last_event.pop(chat_id, None)
        feedback_rating = self._feedback.pop(chat_id, None)

        if len(turns) < 2:
            return None

        latencies = [t.response_time_ms for t in turns if t.response_time_ms > 0]
        conf_values = [t.confidence_numeric for t in turns]
        progression_advances = sum(1 for t in turns if t.fsm_advanced)
        repetition_count = sum(1 for t in turns if t.repetition_detected)
        frustrated_count = sum(1 for t in turns if t.frustration_signal)  # noqa: F841 used below

        # Frustration level (Contact Lens inspired)
        if frustrated_count >= 3:
            frustration_level = "high"
        elif frustrated_count >= 1:
            frustration_level = "medium"
        else:
            frustration_level = "low"

        # Session outcome
        last_state = turns[-1].fsm_state
        if last_state == "RESOLVED":
            outcome = "resolved"
        elif any(t.fsm_state == "SAFETY_ALERT" for t in turns):
            outcome = "escalated"
        elif all(t.confidence_raw in ("none", "") for t in turns):
            outcome = "invalid"
        else:
            # Check for loop
            for i in range(len(turns) - FSM_LOOP_THRESHOLD + 1):
                window = turns[i:i + FSM_LOOP_THRESHOLD]
                states = [t.fsm_state for t in window]
                if len(set(states)) == 1 and states[0] not in ("IDLE", "RESOLVED", ""):
                    outcome = "loop"
                    break
            else:
                outcome = "abandoned"

        # Containment rate (Dialogflow CX)
        containment_rate = 1.0 if outcome == "resolved" else 0.0

        flags = self._detect_all_flags(turns, feedback_rating)

        return SessionQuality(
            session_id=f"{chat_id}:{turns[0].timestamp.isoformat()}",
            chat_id=chat_id,
            platform=str(turns[0].__dict__.get("platform", "telegram")),
            started_at=turns[0].timestamp,
            ended_at=turns[-1].timestamp,
            total_turns=len(turns),
            outcome=outcome,
            containment_rate=containment_rate,
            fsm_progress_rate=progression_advances / len(turns) if turns else 0.0,
            avg_confidence=sum(conf_values) / len(conf_values) if conf_values else 0.0,
            repetition_count=repetition_count,
            frustration_level=frustration_level,
            avg_response_time_ms=int(sum(latencies) / len(latencies)) if latencies else 0,
            p95_response_time_ms=_p95(latencies),
            slot_fill_success=any(t.fsm_state in ("ASSET_IDENTIFIED", "DIAGNOSIS", "RESOLVED") for t in turns),
            judge_scores=None,
            feedback_rating=feedback_rating,
            quality_flags=flags,
        )


def score_ndjson_session(turns_raw: list[dict], feedback_rating: str | None = None) -> SessionQuality | None:
    """Score a completed session from raw NDJSON turn dicts (used by batch mode)."""
    scorer = Scorer()
    scorer._feedback[str(turns_raw[0].get("chat_id", ""))] = feedback_rating or ""

    # Inject all turns
    result = None
    for i, raw in enumerate(turns_raw):
        if raw.get("type") == "feedback":
            continue
        conf_raw = (raw.get("confidence") or "").lower()
        try:
            ts = datetime.fromisoformat(raw.get("timestamp", ""))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            ts = datetime.now(timezone.utc)
        turn = TurnQuality(
            turn_id=i,
            chat_id=str(raw.get("chat_id", "")),
            timestamp=ts,
            user_message=raw.get("user_message", ""),
            bot_response=raw.get("bot_response", ""),
            fsm_state=raw.get("fsm_state", ""),
            intent=raw.get("intent", ""),
            confidence_raw=conf_raw,
            confidence_numeric=CONFIDENCE_MAP.get(conf_raw, 0.1),
            response_time_ms=int(raw.get("response_time_ms") or 0),
            has_photo=bool(raw.get("has_photo", False)),
        )
        r = scorer._ingest_turn(turn)
        if r:
            result = r

    # Force-score whatever is left
    if result is None:
        chat_id = str(turns_raw[0].get("chat_id", ""))
        if chat_id in scorer._sessions:
            result = scorer._score_session(chat_id)

    return result
