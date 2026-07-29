"""European electrical reference-designation decoder (deterministic).

Decodes IEC/EN/DIN/EPLAN-style reference designations into a structured,
provenance-preserving representation. Convention is never state: nothing in
this package may assert that a contact is closed/open, a coil energized, or
equipment safe — terminal-number semantics are naming conventions with
``state_proof: "never"`` (directive Safety laws 1-12).

Leaf-like by design: imports only ``printsense.grader._norm`` from the
package (frozen DAG leaf); never imports interpret/verify/systemgraph.
"""

from .decoder import decode, explain
from .lexer import lex
from .profiles import PROFILES, detect_profile
from .project_profile import LegendRule
from .relationships import migrate_alias_variations, relate
from .semantics import changeover_group

__all__ = [
    "decode", "explain", "lex", "relate", "changeover_group",
    "migrate_alias_variations", "LegendRule", "PROFILES", "detect_profile",
]
