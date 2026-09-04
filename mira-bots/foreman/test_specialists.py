"""Tests for Foreman specialist dispatch roles."""

from __future__ import annotations

import pytest
from specialists import (
    REQUIRED_SECTIONS,
    ROUTING_CARD_ENV,
    SPECIALISTS_DIR,
    VALID_WORKER_ROLES,
    Specialist,
    SpecialistError,
    load_specialist,
    load_specialists,
    render_roster,
    routing_card_enabled,
)

EXPECTED = {
    "mission-planner",
    "repo-archaeologist",
    "software-engineer",
    "fleet-engineer",
    "adversarial-reviewer",
    "verifier-qa",
    "industrial-robotics-engineer",
    "product-researcher",
}


@pytest.fixture(scope="module")
def roles() -> dict[str, Specialist]:
    return load_specialists()


def _valid(name="r", plane="fleet", extra=""):
    body = "\n".join(
        f"{s}\ncontent that is long enough to be a real boundary\n" for s in REQUIRED_SECTIONS
    )
    return f"---\nname: {name}\nmaps_to: something\nplane: {plane}\n{extra}---\n\n{body}"


def test_all_expected_roles_load(roles):
    assert set(roles) == EXPECTED


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_role_answers_every_question(roles, name):
    for heading in REQUIRED_SECTIONS:
        assert roles[name].section(heading), f"{name}: empty {heading}"


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_role_states_a_boundary(roles, name):
    assert len(roles[name].section("## Should NOT")) > 30


# --- do not fork the handbook ----------------------------------------------


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_role_declares_what_it_aliases(roles, name):
    """The failure this whole design exists to prevent is eight new personalities
    forking .claude/agents/. Every card must name what it aliases, or say NEW."""
    assert roles[name].maps_to


def test_only_fleet_engineer_is_new(roles):
    new = {n for n, s in roles.items() if s.maps_to.upper().startswith("NEW")}
    assert new == {"fleet-engineer"}


def test_aliases_point_at_agents_that_exist(roles):
    """A maps_to naming a .claude/agents/ file must name a real one."""
    repo_root = SPECIALISTS_DIR.parents[2]
    for name, spec in roles.items():
        for token in spec.maps_to.split():
            if token.startswith(".claude/agents/") and token.endswith(".md"):
                assert (repo_root / token).is_file(), f"{name} aliases missing {token}"


def test_software_engineer_does_not_absorb_test_engineer(roles):
    """#3570's explicit correction: the builder may run tests, not own the only
    test write."""
    spec = roles["software-engineer"]
    assert "test-engineer" in spec.maps_to
    assert "test-engineer" in spec.section("## Should NOT")


# --- the two axes are not the same axis ------------------------------------


def test_grok_plane_roles_never_launch_a_worker(roles):
    for name, spec in roles.items():
        if spec.plane == "grok":
            assert not spec.launches_a_worker, f"{name} is grok-side but declares a worker_role"


def test_fleet_roles_declare_a_valid_worker_role(roles):
    for name, spec in roles.items():
        if spec.plane == "fleet":
            assert spec.worker_role in VALID_WORKER_ROLES, name


def test_worker_roles_match_mission_loop_enum():
    """VALID_WORKER_ROLES must not drift from mission_loop.WorkerRole."""
    pytest.importorskip("mission_loop")
    from mission_loop import WorkerRole

    assert {r.name for r in WorkerRole} == VALID_WORKER_ROLES


def test_reviewer_and_verifier_are_different_worker_roles(roles):
    """They ask different questions, so they must not share a slot (PR #3572)."""
    assert roles["adversarial-reviewer"].worker_role == "REVIEWER"
    assert roles["verifier-qa"].worker_role == "VERIFIER"


# --- architecture rule -----------------------------------------------------


def test_no_role_is_named_after_a_physical_computer(roles):
    machines = {"alpha", "bravo", "charlie"}
    for name, spec in roles.items():
        assert name.lower() not in machines
        assert spec.title.strip().lower() not in machines


def test_roster_states_the_hierarchy_and_the_enforcement():
    roster = render_roster()
    assert "only one who talks to Mike" in roster
    assert "physical COMPUTERS, never roles" in roster
    assert "mission_loop.ForemanPolicy" in roster
    assert "do not work around it" in roster
    for name in EXPECTED:
        assert name in roster


def test_roster_separates_the_planes():
    roster = render_roster()
    assert "no worker is launched" in roster
    assert "WorkerRole.IMPLEMENTER" in roster
    assert "WorkerRole.REVIEWER" in roster
    assert "WorkerRole.VERIFIER" in roster


# --- malformed definitions fail loudly -------------------------------------


def test_missing_frontmatter_rejected(tmp_path):
    p = tmp_path / "b.md"
    p.write_text("# no frontmatter\n", encoding="utf-8")
    with pytest.raises(SpecialistError, match="frontmatter"):
        load_specialist(p)


def test_missing_maps_to_rejected(tmp_path):
    p = tmp_path / "b.md"
    body = "\n".join(f"{s}\nx\n" for s in REQUIRED_SECTIONS)
    p.write_text(f"---\nname: x\nplane: fleet\n---\n\n{body}", encoding="utf-8")
    with pytest.raises(SpecialistError, match="maps_to"):
        load_specialist(p)


def test_missing_section_rejected(tmp_path):
    p = tmp_path / "b.md"
    p.write_text(
        "---\nname: x\nmaps_to: y\nplane: fleet\n---\n\n## Responsible for\nx\n", encoding="utf-8"
    )
    with pytest.raises(SpecialistError, match="missing section"):
        load_specialist(p)


def test_bad_plane_rejected(tmp_path):
    p = tmp_path / "b.md"
    p.write_text(_valid(plane="somewhere"), encoding="utf-8")
    with pytest.raises(SpecialistError, match="plane"):
        load_specialist(p)


def test_bad_worker_role_rejected(tmp_path):
    p = tmp_path / "b.md"
    p.write_text(_valid(extra="worker_role: JANITOR\n"), encoding="utf-8")
    with pytest.raises(SpecialistError, match="worker_role"):
        load_specialist(p)


def test_grok_role_declaring_a_worker_is_rejected(tmp_path):
    p = tmp_path / "b.md"
    p.write_text(_valid(plane="grok", extra="worker_role: IMPLEMENTER\n"), encoding="utf-8")
    with pytest.raises(SpecialistError, match="never launches a worker"):
        load_specialist(p)


def test_duplicate_names_rejected(tmp_path):
    for f in ("a.md", "b.md"):
        (tmp_path / f).write_text(_valid(name="dupe"), encoding="utf-8")
    with pytest.raises(SpecialistError, match="duplicate"):
        load_specialists(tmp_path)


# --- the seam is opt-in ----------------------------------------------------


def test_routing_card_defaults_off(monkeypatch):
    monkeypatch.delenv(ROUTING_CARD_ENV, raising=False)
    assert routing_card_enabled() is False


@pytest.mark.parametrize("raw", ["1", "true", "YES", "on"])
def test_routing_card_opt_in_values(monkeypatch, raw):
    monkeypatch.setenv(ROUTING_CARD_ENV, raw)
    assert routing_card_enabled() is True


@pytest.mark.parametrize("raw", ["0", "false", "", "maybe"])
def test_routing_card_stays_off_otherwise(monkeypatch, raw):
    monkeypatch.setenv(ROUTING_CARD_ENV, raw)
    assert routing_card_enabled() is False


def test_bot_briefing_is_guarded_by_the_flag():
    """The seam exists but must be inert unless configured."""
    bot = (SPECIALISTS_DIR.parent / "bot.py").read_text(encoding="utf-8")
    assert "_brief_agent" in bot
    assert "if not routing_card_enabled():" in bot
    # sent once at creation, not prepended to every turn
    assert bot.count("await self._brief_agent(") == 1
