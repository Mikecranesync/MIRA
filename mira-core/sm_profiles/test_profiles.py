"""Tests for SM Profile schema, loader, and CLI."""

from __future__ import annotations

import sys
from pathlib import Path

# Hyphenated parent dir (mira-core) isn't a valid package. Inject parent.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from pydantic import ValidationError  # noqa: E402

from sm_profiles import cli as profiles_cli  # noqa: E402
from sm_profiles.profile_loader import list_profiles, load_profile  # noqa: E402
from sm_profiles.schema import SmProfile, SmProperty, SmRelationship  # noqa: E402

SEED_NAMES = ("conveyor_drive_v1", "zone_heater_v1", "centrifugal_pump_v1")


def test_list_profiles_returns_three_seeds():
    names = list_profiles()
    for seed in SEED_NAMES:
        assert seed in names


@pytest.mark.parametrize("name", SEED_NAMES)
def test_load_each_seed_profile_validates(name: str):
    profile = load_profile(name)
    assert profile.type
    assert profile.version.count(".") == 2
    assert len(profile.properties) >= 1


def test_load_missing_profile_raises_file_not_found():
    with pytest.raises(FileNotFoundError):
        load_profile("not_a_real_profile")


def test_property_rejects_inverted_normal_range():
    with pytest.raises(ValidationError):
        SmProperty(
            name="x",
            engineeringUnit="u",
            normalRangeMin=10.0,
            normalRangeMax=5.0,
            alarmHigh=20.0,
            alarmLow=1.0,
        )


def test_property_rejects_alarm_low_above_normal_min():
    with pytest.raises(ValidationError):
        SmProperty(
            name="x",
            engineeringUnit="u",
            normalRangeMin=10.0,
            normalRangeMax=20.0,
            alarmHigh=30.0,
            alarmLow=12.0,
        )


def test_property_rejects_alarm_high_below_normal_max():
    with pytest.raises(ValidationError):
        SmProperty(
            name="x",
            engineeringUnit="u",
            normalRangeMin=10.0,
            normalRangeMax=20.0,
            alarmHigh=15.0,
            alarmLow=5.0,
        )


def test_relationship_rejects_unknown_edge():
    with pytest.raises(ValidationError):
        SmRelationship(edge="childOf", targetType="Machine")  # type: ignore[arg-type]


def test_profile_rejects_empty_properties_list():
    with pytest.raises(ValidationError):
        SmProfile(type="T", version="1.0.0", properties=[], relationships=[])


def test_profile_rejects_invalid_version():
    prop = dict(
        name="x",
        engineeringUnit="u",
        normalRangeMin=0.0,
        normalRangeMax=1.0,
        alarmHigh=1.0,
        alarmLow=0.0,
    )
    with pytest.raises(ValidationError):
        SmProfile(type="T", version="1.0", properties=[prop])  # missing patch


def test_cli_list_prints_three_names(capsys):
    rc = profiles_cli.main(["list"])
    out = capsys.readouterr().out.strip().splitlines()
    assert rc == 0
    assert set(SEED_NAMES).issubset(set(out))


def test_cli_show_missing_returns_code_2(capsys):
    rc = profiles_cli.main(["show", "not_a_profile"])
    assert rc == 2


def test_cli_show_valid_prints_json(capsys):
    rc = profiles_cli.main(["show", "conveyor_drive_v1"])
    out = capsys.readouterr().out
    assert rc == 0
    assert '"type"' in out
    assert "ConveyorDrive" in out


def test_cli_no_args_returns_2():
    assert profiles_cli.main([]) == 2
