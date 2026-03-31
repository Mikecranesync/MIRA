"""FSM Pydantic data models.

StateVector: a single observed state with a millisecond timestamp.
TransitionEnvelope: statistical summary of a state transition.
FSMModel: the complete learned automaton for a single asset.
"""

from __future__ import annotations

from pydantic import BaseModel


class StateVector(BaseModel):
    """A single state observation from the equipment FSM."""

    state: str
    timestamp_ms: int


class TransitionEnvelope(BaseModel):
    """Statistical profile for a from_state → to_state transition.

    Attributes:
        mean_ms: Mean transition duration in milliseconds.
        stddev_ms: Standard deviation of transition duration.
        min_ms: Minimum observed duration.
        max_ms: Maximum observed duration.
        count: Number of times this transition has been observed.
        is_accepting: True when stddev is unusually high (anomaly marker).
        is_rare: True when this transition is observed rarely relative to
                 the total transition population.
    """

    mean_ms: float
    stddev_ms: float
    min_ms: float
    max_ms: float
    count: int
    is_accepting: bool = False
    is_rare: bool = False


class FSMModel(BaseModel):
    """Learned finite-state machine for a single equipment asset.

    Attributes:
        asset_id: Equipment identifier.
        transitions: Nested dict[from_state][to_state] → TransitionEnvelope.
        cycle_count: Total number of state transitions observed.
        created_at: ISO 8601 timestamp of when the model was built.
    """

    asset_id: str
    transitions: dict[str, dict[str, TransitionEnvelope]]
    cycle_count: int
    created_at: str  # ISO timestamp
