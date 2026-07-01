"""
Signal-level DIFFERENCE detectors + event grouping -- Layer-2/3 SEED.
=================================================================
Pure functions, no I/O, deterministic, dual Python 2.7 / 3.12 (same discipline as
rules_core.py: no f-strings, no annotations, plain classes, %-formatting, ASCII).

These emit FACTUAL OBSERVATIONS -- "what changed vs normal" -- NOT human
explanations. They deliberately do not need to know a tag's human meaning: a
signal is just a name + a stream of values. Higher layers (context resolver +
supervisor) turn "Signal C dropped to 287" into "VFD DC bus sagged during a
conveyor startup". See docs/product/mira_signal_difference_engine_prd.md.

Relationship to rules_core.py (A0-A12): those encode KNOWN failure modes with
hand-tuned thresholds. THESE detect DEVIATION FROM LEARNED/DECLARED NORMAL
without prior knowledge of the failure mode. The two are complementary.

This is a SEED for the difference engine (PRD Phase 2/3), scoped to the four
detector primitives + the grouping compression. It is intentionally small and
does not replace the mira-relay tag_diff_logger (edge/threshold/fault-window
compression already in production) -- it adds the baseline/timing primitives
that tag_diff_logger does not cover, in a form that unit-tests offline.
"""

OUT_OF_BASELINE = "OUT_OF_BASELINE"
STUCK = "STUCK"
DELAYED_TRANSITION = "DELAYED_TRANSITION"
DRIFT = "DRIFT"


class Observation(object):
    """A single factual difference. No human meaning attached (that is Layer 4/5)."""

    def __init__(self, signal, kind, detail, value=None, expected=None, ts=None, magnitude=None):
        self.signal = signal
        self.kind = kind
        self.detail = detail          # factual sentence, no cause/explanation
        self.value = value
        self.expected = expected      # the learned/declared normal (range, lag, etc.)
        self.ts = ts
        self.magnitude = magnitude    # how far outside normal (unitless helper for ranking)

    def to_dict(self):
        return {"signal": self.signal, "kind": self.kind, "detail": self.detail,
                "value": self.value, "expected": self.expected, "ts": self.ts,
                "magnitude": self.magnitude}

    def __repr__(self):
        return "Observation(%s, %s)" % (self.signal, self.kind)


class MachineEvent(object):
    """A group of observations that occurred close together in time -- one event,
    not N alerts. Compression happens here; explanation happens in the supervisor."""

    def __init__(self, index, start_ts, end_ts, observations):
        self.index = index
        self.start_ts = start_ts
        self.end_ts = end_ts
        self.observations = observations

    @property
    def signals(self):
        seen = []
        for o in self.observations:
            if o.signal not in seen:
                seen.append(o.signal)
        return seen

    def to_dict(self):
        return {"index": self.index, "start_ts": self.start_ts, "end_ts": self.end_ts,
                "signal_count": len(self.signals), "signals": self.signals,
                "observations": [o.to_dict() for o in self.observations]}

    def __repr__(self):
        return "MachineEvent(#%s, %d obs, %d signals)" % (
            self.index, len(self.observations), len(self.signals))


def detect_out_of_baseline(signal, value, lo, hi, ts=None):
    """Value outside its learned normal [lo, hi]. Returns Observation or None."""
    if value is None or lo is None or hi is None:
        return None
    if lo <= value <= hi:
        return None
    if value < lo:
        mag = lo - value
        detail = "Signal %s normally stays between %s and %s. Now %s (%.3g below normal)." % (
            signal, lo, hi, value, mag)
    else:
        mag = value - hi
        detail = "Signal %s normally stays between %s and %s. Now %s (%.3g above normal)." % (
            signal, lo, hi, value, mag)
    return Observation(signal, OUT_OF_BASELINE, detail, value=value,
                       expected=(lo, hi), ts=ts, magnitude=mag)


def detect_stuck(signal, samples, min_span_s, ts_now=None):
    """A value that has not changed across at least min_span_s.
    samples: list of (ts, value), oldest first. Returns Observation or None."""
    if not samples or len(samples) < 2:
        return None
    values = [v for _, v in samples]
    first_v = values[0]
    if any(v != first_v for v in values):
        return None  # it moved -> not stuck
    span = samples[-1][0] - samples[0][0]
    if span < min_span_s:
        return None
    detail = "Signal %s has not changed (%s) for %.1fs." % (signal, first_v, span)
    return Observation(signal, STUCK, detail, value=first_v,
                       expected=("changing",), ts=ts_now if ts_now is not None else samples[-1][0],
                       magnitude=span)


def detect_delayed_transition(a_signal, b_signal, a_ts, b_ts, normal_lag_s, tol_s):
    """Signal B normally changes ~normal_lag_s after Signal A. Flag if it was late.
    Returns Observation or None."""
    if a_ts is None or b_ts is None:
        return None
    observed = b_ts - a_ts
    if observed <= normal_lag_s + tol_s:
        return None
    detail = ("Signal %s normally changes %.2gs after %s. Now it changed %.2gs later "
              "(%.2gs late)." % (b_signal, normal_lag_s, a_signal, observed,
                                 observed - normal_lag_s))
    return Observation(b_signal, DELAYED_TRANSITION, detail, value=observed,
                       expected=normal_lag_s, ts=b_ts, magnitude=observed - normal_lag_s)


def group_observations(observations, window_s):
    """Compress many observations into fewer MachineEvents: observations whose ts
    fall within window_s of the running event are one event. Deterministic
    (sorted by ts, then signal). Observations without a ts go into event #0."""
    if not observations:
        return []
    dated = [o for o in observations if o.ts is not None]
    undated = [o for o in observations if o.ts is None]
    dated.sort(key=lambda o: (o.ts, o.signal))

    events = []
    cur = []
    cur_start = None
    for o in dated:
        if not cur:
            cur = [o]; cur_start = o.ts
            continue
        if o.ts - cur[-1].ts <= window_s:
            cur.append(o)
        else:
            events.append(MachineEvent(len(events), cur_start, cur[-1].ts, cur))
            cur = [o]; cur_start = o.ts
    if cur:
        events.append(MachineEvent(len(events), cur_start, cur[-1].ts, cur))

    if undated:
        events.append(MachineEvent(len(events), None, None, undated))
    return events
