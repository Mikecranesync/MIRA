"""Gateway-side vs relay-side CV-101 allowlist parity.

``ignition/project/approved_tags.json`` is the gateway-side allowlist (gates
the WebDev tags endpoint and the tag-stream Gateway Timer's local filter,
``collector.filter_allowlisted`` -- ignition/webdev/FactoryLM/api/tags/collector.py).
``tools/seeds/approved_tags_conveyor.sql`` is the relay-side allowlist
(defense-in-depth, enforced fail-closed by ``mira-relay/tag_ingest.ingest_batch``).
A tag present on only one side breaks somewhere in the pipeline:

  * gateway-only tag -> streamed by the timer, then rejected
    ``not_allowlisted`` by the relay.
  * relay-only tag   -> never streamed (the gateway drops it before it is ever
    sent), so the relay-side row is simply inert.

This test set-compares the two allowlists and pins the ACTUAL, inspected
delta rather than silently tolerating drift. Inspected 2026-07-03 (see
docs/runbooks/cv101-bench-to-cloud-first-tag-row.md): the SQL seed is a
strict subset of the gateway JSON -- 58 of the gateway's 65 tags are seeded
on the relay side. The 7 gateway-only tags are real, documented gaps (not a
deliberate design choice) -- see KNOWN_GATEWAY_ONLY_TAGS below. If this test
starts failing, either (a) a genuinely new, undocumented gap opened --
investigate and fix the JSON/SQL -- or (b) a new, deliberate difference needs
a line added here with a reason, per this repo's "document the delta, don't
hide it" convention (tests/test_northwind_cv200_seed_and_config.py does the
same for the Northwind CV-200 allowlist superset).
"""

from __future__ import annotations

import json
import os
import re

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
_JSON_PATH = os.path.join(_REPO_ROOT, "ignition", "project", "approved_tags.json")
_SQL_PATH = os.path.join(_REPO_ROOT, "tools", "seeds", "approved_tags_conveyor.sql")

_ROW_RE = re.compile(r"'ignition',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'::ltree")

# Gateway-side tags NOT (yet) seeded on the relay side. Documented, not
# hidden -- a real gap the runbook flags as follow-up work, not a design
# decision.
KNOWN_GATEWAY_ONLY_TAGS: set[str] = {
    # Config lookup used by gateway scripts (mira_tag_map / mira_setup); not a
    # telemetry value read by tag-stream.py's leaf-tag browse/read loop.
    # ignition/project/approved_tags.json line ~69.
    "[default]MIRA/Config/conveyor/map",
    # 6 newer VFD-analyzer tags added to the gateway allowlist for the
    # NorthwindBottling / VFD-analyzer work (see
    # tests/test_northwind_cv200_seed_and_config.py::
    # test_northwind_allowlist_is_superset_of_garage_rig_tags: "the staged
    # NorthwindBottling Perspective project binds additional MIRA_IOCheck
    # tags ... that the garage seed predates"). Not yet backfilled into
    # tools/seeds/approved_tags_conveyor.sql -- a real gap, tracked as
    # follow-up in the runbook, not a design decision.
    "[default]MIRA_IOCheck/VFD/vfd_warn_code",
    "[default]MIRA_IOCheck/VFD/vfd_freq_cmd",
    "[default]MIRA_IOCheck/VFD/vfd_torque",
    "[default]MIRA_IOCheck/VFD/vfd_motor_rpm",
    "[default]MIRA_IOCheck/VFD/vfd_power",
    "[default]MIRA_IOCheck/VFD/vfd_last_fault",
}

# No relay-only tags as of 2026-07-03 -- the SQL seed is a strict subset of
# the gateway JSON. If a relay-only tag is ever intentionally added, name it
# here with a reason instead of loosening the assertion below.
KNOWN_RELAY_ONLY_TAGS: set[str] = set()


def _gateway_tags() -> set[str]:
    with open(_JSON_PATH, encoding="utf-8") as fh:
        return set(json.load(fh)["tags"])


def _relay_tags() -> set[str]:
    with open(_SQL_PATH, encoding="utf-8") as fh:
        sql = fh.read()
    return {src for src, _norm, _uns in _ROW_RE.findall(sql)}


def test_gateway_and_relay_allowlists_have_rows():
    assert _gateway_tags()
    assert _relay_tags()


def test_gateway_only_tags_match_the_documented_list():
    gateway, relay = _gateway_tags(), _relay_tags()
    actual_gateway_only = gateway - relay
    assert actual_gateway_only == KNOWN_GATEWAY_ONLY_TAGS, (
        "gateway-only allowlist drift is undocumented -- update "
        "KNOWN_GATEWAY_ONLY_TAGS (with a reason) or fix the SQL seed. "
        f"actual={sorted(actual_gateway_only)} documented={sorted(KNOWN_GATEWAY_ONLY_TAGS)}"
    )


def test_relay_only_tags_match_the_documented_list():
    gateway, relay = _gateway_tags(), _relay_tags()
    actual_relay_only = relay - gateway
    assert actual_relay_only == KNOWN_RELAY_ONLY_TAGS, (
        "relay-only allowlist drift is undocumented (a tag the relay would "
        "accept that the gateway can never send) -- "
        f"actual={sorted(actual_relay_only)} documented={sorted(KNOWN_RELAY_ONLY_TAGS)}"
    )


def test_symmetric_difference_is_fully_documented():
    gateway, relay = _gateway_tags(), _relay_tags()
    sym_diff = gateway ^ relay
    documented = KNOWN_GATEWAY_ONLY_TAGS | KNOWN_RELAY_ONLY_TAGS
    assert sym_diff == documented, (
        f"undocumented allowlist drift: sym_diff={sorted(sym_diff)} "
        f"documented={sorted(documented)}"
    )
