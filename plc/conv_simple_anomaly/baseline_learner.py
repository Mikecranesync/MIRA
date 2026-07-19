"""
baseline_learner.py -- learn "normal" from history (Difference-Engine Layer 2/3).
=================================================================
Pure functions, no I/O, deterministic, dual Python 2.7 / 3.12 (same discipline as
rules_core.py / difference_detectors.py: no f-strings, no annotations, plain
classes, %-formatting, ASCII, no third-party deps -- math.sqrt only).

Learns a per-signal normal RANGE (lo/hi = observed min/max, matching the PRD's
"normally stays between 318 and 325" framing) plus mean/stddev for the drift
detector, and a normal LAG between two paired signals for delayed-transition.

The learner is source-agnostic: it takes `samples = [(ts, value, quality), ...]`
(oldest first). Feed it from tag_events, diagnostic_trend_signals, a Litmus read,
or a SimLab replay -- it does not care. Callers declare the operating context
(e.g. "startup" vs "steady-run"); the learner never guesses it.

See docs/product/mira_signal_difference_engine_prd.md and
docs/plans/2026-06-30-mira-difference-engine-gap-closure.md.
"""
import math


class Baseline(object):
    """Learned/declared normal for one signal in one operating context."""

    def __init__(self, signal, context, lo, hi, mean, stddev, sample_count,
                 window_s, method, min_sample_count=10):
        self.signal = signal
        self.context = context          # 'startup' | 'steady-run' | 'stopping' | 'idle'
        self.lo = lo
        self.hi = hi
        self.mean = mean
        self.stddev = stddev
        self.sample_count = sample_count
        self.window_s = window_s
        self.method = method            # 'learned' | 'declared'
        self.min_sample_count = min_sample_count

    @property
    def sufficient(self):
        """True once enough good samples were seen -- caller rejects if False."""
        return self.sample_count >= self.min_sample_count

    def to_dict(self):
        return {"signal": self.signal, "context": self.context, "lo": self.lo,
                "hi": self.hi, "mean": self.mean, "stddev": self.stddev,
                "sample_count": self.sample_count, "window_s": self.window_s,
                "method": self.method, "sufficient": self.sufficient}

    def __repr__(self):
        return "Baseline(%s/%s, [%s..%s], n=%s)" % (
            self.signal, self.context, self.lo, self.hi, self.sample_count)


class Lag(object):
    """Learned normal time-delay from signal A's change to signal B's change."""

    def __init__(self, a_signal, b_signal, context, normal_lag_s, stddev_lag_s,
                 pair_count, method, min_pair_count=5):
        self.a_signal = a_signal
        self.b_signal = b_signal
        self.context = context
        self.normal_lag_s = normal_lag_s
        self.stddev_lag_s = stddev_lag_s
        self.pair_count = pair_count
        self.method = method
        self.min_pair_count = min_pair_count

    @property
    def sufficient(self):
        return self.pair_count >= self.min_pair_count

    def to_dict(self):
        return {"a_signal": self.a_signal, "b_signal": self.b_signal,
                "context": self.context, "normal_lag_s": self.normal_lag_s,
                "stddev_lag_s": self.stddev_lag_s, "pair_count": self.pair_count,
                "method": self.method, "sufficient": self.sufficient}


def _stats(values):
    n = len(values)
    mean = sum(values) / float(n)
    var = sum((v - mean) * (v - mean) for v in values) / float(n)
    return mean, math.sqrt(var)


def learn_signal_baseline(signal, samples, context_key="steady-run", min_sample_count=10):
    """samples: [(ts, value, quality), ...] oldest first. Skips quality != 'good'
    and None values. Returns a Baseline (check .sufficient before trusting it)."""
    good = [(t, v) for (t, v, q) in samples if q == "good" and v is not None]
    if not good:
        return Baseline(signal, context_key, None, None, None, None, 0, 0.0,
                        "learned", min_sample_count)
    vals = [v for _, v in good]
    mean, stddev = _stats(vals)
    window_s = good[-1][0] - good[0][0]
    return Baseline(signal, context_key, min(vals), max(vals), mean, stddev,
                    len(vals), window_s, "learned", min_sample_count)


def learn_paired_lag(a_signal, b_signal, a_edges, b_edges, context_key="steady-run",
                     min_pair_count=5):
    """a_edges / b_edges: [ts, ...] of when each signal changed (edge timestamps).
    For each A edge, pair with the first B edge at or after it; learn mean+stddev
    of the deltas. Returns a Lag (check .sufficient)."""
    b_sorted = sorted(b_edges)
    deltas = []
    for a in sorted(a_edges):
        nb = None
        for b in b_sorted:
            if b >= a:
                nb = b
                break
        if nb is not None:
            deltas.append(nb - a)
    if not deltas:
        return Lag(a_signal, b_signal, context_key, None, None, 0, "learned", min_pair_count)
    mean, stddev = _stats(deltas)
    return Lag(a_signal, b_signal, context_key, mean, stddev, len(deltas),
               "learned", min_pair_count)
