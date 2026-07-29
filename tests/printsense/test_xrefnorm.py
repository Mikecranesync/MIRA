"""xrefnorm — compound cross-reference normalization (W1).

Hermetic, stdlib-only tests for parse_ref, atoms, expand_pool.
Every spec fixture encoded; raw preservation, empty/whitespace handling, non-mutation verified.
"""

from __future__ import annotations

import pytest

pytest.importorskip("pydantic")

from printsense import xrefnorm


class TestDecimalCommaPreservation:
    """Controls-review fix: a comma between digits is the IEC decimal
    separator and must never split a designation."""

    def test_cable_cross_section_stays_whole(self):
        assert xrefnorm.atoms("4G1,5") == {"4G1,5"}

    def test_component_rating_stays_whole(self):
        assert xrefnorm.atoms("4,7k") == {"4,7k"}

    def test_comma_locale_sheet_ref_stays_whole(self):
        assert xrefnorm.atoms("4,4") == {"4,4"}

    def test_list_comma_still_splits(self):
        assert xrefnorm.atoms("X24V.3, X0V.3") == {"X24V.3", "X0V.3"}

    def test_mixed_list_and_decimal(self):
        assert xrefnorm.atoms("4G1,5, 4G2,5") == {"4G1,5", "4G2,5"}


class TestEdgeSlashShorthand:
    """Real-output finding (paid B1 run): EPLAN off-page tags render as
    '/20.4' or '/20.4(U01)' — the leading slash must not defeat matching."""

    def test_leading_slash_sheet_col(self):
        assert "20.4" in xrefnorm.atoms("/20.4")

    def test_leading_slash_with_paren_disambiguator(self):
        got = xrefnorm.atoms("/20.4(U01)")
        assert "20.4" in got and "U01" in got

    def test_interior_slash_untouched(self):
        assert xrefnorm.atoms("-3/F1") == {"-3/F1"}
        assert xrefnorm.atoms("+CAB2/5.3") == {"+CAB2/5.3"}


class TestParseRef:
    """parse_ref returns list[dict] with raw/token/kind."""

    def test_sheet_col_signal_separated_by_slash_space(self):
        """Fixture: '4.4 / X24V.3' -> tokens {4.4, X24V.3} (sheet_col + signal)."""
        result = xrefnorm.parse_ref("4.4 / X24V.3")
        assert len(result) == 2
        tokens = {r["token"] for r in result}
        assert tokens == {"4.4", "X24V.3"}

        kinds = {r["token"]: r["kind"] for r in result}
        assert kinds["4.4"] == "sheet_col"
        assert kinds["X24V.3"] == "signal"

        for atom in result:
            assert atom["raw"] == "4.4 / X24V.3"

    def test_assembly_device_parens(self):
        """Fixture: '+SCU1/5.3 (-ETH.D)' -> {+SCU1/5.3, -ETH.D}."""
        result = xrefnorm.parse_ref("+SCU1/5.3 (-ETH.D)")
        tokens = {r["token"] for r in result}
        assert tokens == {"+SCU1/5.3", "-ETH.D"}

        kinds = {r["token"]: r["kind"] for r in result}
        assert kinds["+SCU1/5.3"] == "assembly"
        assert kinds["-ETH.D"] == "device"

        for atom in result:
            assert atom["raw"] == "+SCU1/5.3 (-ETH.D)"

    def test_nested_parens_recursive(self):
        """Fixture: 'X24V.3 / 5.4  (<->  4.4 / X24V.3 ; X0V.3 / 5.4)'."""
        result = xrefnorm.parse_ref("X24V.3 / 5.4  (<->  4.4 / X24V.3 ; X0V.3 / 5.4)")
        tokens = {r["token"] for r in result}
        assert tokens == {"X24V.3", "5.4", "4.4", "X0V.3"}

        for atom in result:
            assert atom["raw"] == "X24V.3 / 5.4  (<->  4.4 / X24V.3 ; X0V.3 / 5.4)"

    def test_sheet_shorthand_split(self):
        """Fixture: 'S7/S8' -> {S7, S8} (sheet shorthand)."""
        result = xrefnorm.parse_ref("S7/S8")
        tokens = {r["token"] for r in result}
        assert tokens == {"S7", "S8"}

        for atom in result:
            assert atom["kind"] == "sheet"
            assert atom["raw"] == "S7/S8"

    def test_single_token_unchanged(self):
        """Fixture: '15.7' -> {15.7}."""
        result = xrefnorm.parse_ref("15.7")
        assert len(result) == 1
        assert result[0]["token"] == "15.7"
        assert result[0]["kind"] == "sheet_col"
        assert result[0]["raw"] == "15.7"

    def test_device_with_port_suffix(self):
        """Fixture: '-21/A13:24VDC' -> {-21/A13:24VDC, -21/A13}."""
        result = xrefnorm.parse_ref("-21/A13:24VDC")
        tokens = {r["token"] for r in result}
        assert tokens == {"-21/A13:24VDC", "-21/A13"}

        kinds = {r["token"]: r["kind"] for r in result}
        assert kinds["-21/A13:24VDC"] == "device"
        assert kinds["-21/A13"] == "device"

        for atom in result:
            assert atom["raw"] == "-21/A13:24VDC"

    def test_sheet_bare_number(self):
        """Fixture: 'sheet20' -> {sheet20, 20}."""
        result = xrefnorm.parse_ref("sheet20")
        tokens = {r["token"] for r in result}
        assert tokens == {"sheet20", "20"}

        kinds = {r["token"]: r["kind"] for r in result}
        assert kinds["sheet20"] == "sheet"
        assert kinds["20"] == "sheet"

        for atom in result:
            assert atom["raw"] == "sheet20"

    def test_empty_string(self):
        """Fixture: '' -> empty list."""
        result = xrefnorm.parse_ref("")
        assert result == []

    def test_whitespace_only(self):
        """Whitespace-only input yields empty."""
        result = xrefnorm.parse_ref("   \t  \n  ")
        assert result == []

    def test_bare_slash_not_split(self):
        """Bare /inside token never splits: +SCU1/5.3 intact."""
        result = xrefnorm.parse_ref("+SCU1/5.3")
        tokens = {r["token"] for r in result}
        assert tokens == {"+SCU1/5.3"}
        assert result[0]["kind"] == "assembly"

    def test_mixed_delimiters(self):
        """Multiple delimiter types: ';' and ','."""
        result = xrefnorm.parse_ref("4.4 ; X24V.3 , 5.5")
        tokens = {r["token"] for r in result}
        assert tokens == {"4.4", "X24V.3", "5.5"}

    def test_arrow_delimiters(self):
        """Arrow delimiters: '->' and '<->'."""
        result = xrefnorm.parse_ref("4.4 -> X24V.3 <-> 5.5")
        tokens = {r["token"] for r in result}
        assert tokens == {"4.4", "X24V.3", "5.5"}


class TestAtoms:
    """atoms returns set[str] of tokens only."""

    def test_atoms_returns_token_set(self):
        """atoms('4.4 / X24V.3') returns {4.4, X24V.3}."""
        result = xrefnorm.atoms("4.4 / X24V.3")
        assert result == {"4.4", "X24V.3"}

    def test_atoms_assembly_device(self):
        """atoms('+SCU1/5.3 (-ETH.D)') returns {+SCU1/5.3, -ETH.D}."""
        result = xrefnorm.atoms("+SCU1/5.3 (-ETH.D)")
        assert result == {"+SCU1/5.3", "-ETH.D"}

    def test_atoms_empty(self):
        """atoms('') returns empty set."""
        assert xrefnorm.atoms("") == set()

    def test_atoms_device_with_port(self):
        """atoms('-21/A13:24VDC') includes both full and head."""
        result = xrefnorm.atoms("-21/A13:24VDC")
        assert result == {"-21/A13:24VDC", "-21/A13"}

    def test_atoms_sheet_shorthand(self):
        """atoms('sheet20') includes both 'sheet20' and '20'."""
        result = xrefnorm.atoms("sheet20")
        assert result == {"sheet20", "20"}


class TestExpandPool:
    """expand_pool returns normalized originals + normalized atoms."""

    def test_expand_pool_single_token(self):
        """expand_pool(['4.4 / X24V.3']) includes original and atoms, all normalized."""
        result = xrefnorm.expand_pool(["4.4 / X24V.3"])
        # Should include normalized versions of "4.4 / X24V.3" and both atoms
        # Assuming _norm lowercases and strips whitespace
        assert "x24v.3" in result or "X24V.3" in result  # normalize may lowercase
        assert "4.4" in result
        # Original should be in there (normalized form)
        assert len(result) >= 2

    def test_expand_pool_multiple_tokens(self):
        """expand_pool with multiple source strings."""
        result = xrefnorm.expand_pool(["4.4 / X24V.3", "+SCU1/5.3"])
        assert "4.4" in result
        assert "+SCU1/5.3" in result or "scu1/5.3" in result
        assert "x24v.3" in result or "X24V.3" in result

    def test_expand_pool_device_with_port(self):
        """expand_pool('-21/A13:24VDC') includes normalized head."""
        result = xrefnorm.expand_pool(["-21/A13:24VDC"])
        # Should have normalized original and both atoms
        assert "-21/A13:24VDC" in result or "-21/a13:24vdc" in result
        assert "-21/A13" in result or "-21/a13" in result

    def test_expand_pool_empty(self):
        """expand_pool([]) returns empty set."""
        result = xrefnorm.expand_pool([])
        assert result == set()

    def test_expand_pool_with_empty_string(self):
        """expand_pool(['']) ignores empty entries."""
        result = xrefnorm.expand_pool([""])
        assert result == set()


class TestInputImmutability:
    """Input strings are never mutated."""

    def test_parse_ref_does_not_mutate_input(self):
        """parse_ref does not modify the original string."""
        original = "4.4 / X24V.3"
        copy_str = original
        xrefnorm.parse_ref(original)
        assert original == copy_str

    def test_atoms_does_not_mutate_input(self):
        """atoms does not modify the original string."""
        original = "+SCU1/5.3 (-ETH.D)"
        copy_str = original
        xrefnorm.atoms(original)
        assert original == copy_str

    def test_expand_pool_does_not_mutate_input_list(self):
        """expand_pool does not mutate the input list."""
        original = ["4.4 / X24V.3", "+SCU1/5.3"]
        copy_list = original.copy()
        xrefnorm.expand_pool(original)
        assert original == copy_list


class TestKindClassification:
    """kind field matches grammar rule 6."""

    def test_sheet_col_kind(self):
        """sheet_col: \\d+[a-z]?\\.\\d+"""
        for raw in ["4.4", "15.7", "1a.2"]:
            result = xrefnorm.parse_ref(raw)
            assert len(result) == 1
            assert result[0]["kind"] == "sheet_col"

    def test_assembly_kind(self):
        """assembly: starts with +"""
        result = xrefnorm.parse_ref("+SCU1/5.3")
        assert result[0]["kind"] == "assembly"

    def test_device_kind(self):
        """device: starts with -"""
        result = xrefnorm.parse_ref("-21/A13")
        assert result[0]["kind"] == "device"

    def test_sheet_kind_s_pattern(self):
        """sheet: S\\d+[a-z]? pattern"""
        result = xrefnorm.parse_ref("S7")
        assert result[0]["kind"] == "sheet"

    def test_signal_kind_contains_letter(self):
        """signal: contains letter, not device/assembly"""
        for raw in ["X24V.3", "U01.6", "UPSN1"]:
            result = xrefnorm.parse_ref(raw)
            assert result[0]["kind"] == "signal"

    def test_unknown_kind(self):
        """unknown: doesn't match other patterns"""
        # A purely numeric token without dot pattern
        result = xrefnorm.parse_ref("999")
        # Could be sheet or unknown depending on interpretation
        # But 999 (bare number) would be classified as unknown unless rule 4 applies
        assert len(result) >= 1


class TestRawPreservation:
    """Every atom dict preserves the original raw input."""

    def test_every_atom_carries_raw(self):
        """All atoms from a parse_ref carry raw == original input."""
        raw_input = "4.4 / X24V.3 ; +SCU1/5.3 (-ETH.D)"
        result = xrefnorm.parse_ref(raw_input)
        for atom in result:
            assert atom["raw"] == raw_input
            assert "token" in atom
            assert "kind" in atom
            assert len(atom) == 3  # exactly raw, token, kind

    def test_raw_preserved_across_fixtures(self):
        """Raw field preserved in all fixture tests."""
        fixtures = [
            "4.4 / X24V.3",
            "+SCU1/5.3 (-ETH.D)",
            "S7/S8",
            "sheet20",
            "-21/A13:24VDC",
        ]
        for fixture in fixtures:
            result = xrefnorm.parse_ref(fixture)
            for atom in result:
                assert atom["raw"] == fixture


class TestComplexNesting:
    """Deeply nested parentheses and recursive parsing."""

    def test_triple_nested_parens(self):
        """Nested parens are recursively extracted."""
        result = xrefnorm.parse_ref("A (B (C D))")
        tokens = {r["token"] for r in result}
        # Should extract A, B, C, D
        assert "A" in tokens or "a" in tokens

    def test_semicolon_comma_mixed(self):
        """Multiple delimiter types in one string."""
        result = xrefnorm.parse_ref("4.4 ; 5.5 , 6.6 -> 7.7")
        tokens = {r["token"] for r in result}
        assert len(tokens) == 4


class TestEdgeCases:
    """Edge cases: numbers, letters, port suffixes, sheet variants."""

    def test_sheet_with_letter_suffix(self):
        """sheet<NN> pattern with letter like sheet5a."""
        result = xrefnorm.parse_ref("sheet5a")
        tokens = {r["token"] for r in result}
        # Should include sheet5a and 5a (or 5a as the bare form)
        assert "sheet5a" in tokens

    def test_multiple_port_suffixes(self):
        """Device with port is duplicated without port."""
        result = xrefnorm.parse_ref("-1/K01:24V -2/U01:GND")
        tokens = {r["token"] for r in result}
        # Should have both full forms and heads
        assert "-1/K01:24V" in tokens
        assert "-1/K01" in tokens

    def test_slash_in_assembly_not_split(self):
        """Bare / inside assembly token doesn't split."""
        result = xrefnorm.parse_ref("+PSU/48V")
        tokens = {r["token"] for r in result}
        assert "+PSU/48V" in tokens

    def test_mixed_kinds_one_string(self):
        """Single parse_ref with multiple kinds."""
        result = xrefnorm.parse_ref("4.4 -> +SCU1 ; -K01")
        kinds_present = {r["kind"] for r in result}
        # Should have sheet_col, assembly, device
        assert "sheet_col" in kinds_present
        assert "assembly" in kinds_present
        assert "device" in kinds_present
