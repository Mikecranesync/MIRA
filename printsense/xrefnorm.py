"""Compound cross-reference normalization (W1).

Parse compound reference strings (sheet_col, signals, devices, assemblies) into
atomic references with kind classification and raw preservation.

API:
- parse_ref(raw: str) -> list[dict]  — split into atoms; each: {raw, token, kind}
- atoms(raw: str) -> set[str]        — just the token strings
- expand_pool(tokens) -> set[str]    — normalized originals + normalized atoms

Grammar rules (see spec for details):
1. Split on `;`, `,`, `<->`, `->`, ` / ` (whitespace-surrounded slash)
   Bare `/` inside token never splits
2. Parenthesized segments extracted and recursively parsed; parens not atoms
3. `S<digits>/S<digits>` splits on `/` into sheet atoms
4. `sheet<NN>` yields bare `<NN>` as second atom (kind sheet)
5. Device with `:port` suffix also yields head without port
6. Kind classification: sheet_col|assembly|device|sheet|signal|unknown
7. Whitespace-only/empty atoms dropped; input never mutated
"""

from __future__ import annotations

import re
from typing import TypedDict

from .grader import _norm


class AtomDict(TypedDict):
    """Atom dictionary: raw input, normalized token, kind."""

    raw: str
    token: str
    kind: str


def parse_ref(raw: str) -> list[dict]:
    """Parse a compound reference string into atomic references.

    Each atom carries the original raw input string, normalized token, and kind.

    Args:
        raw: Compound reference string (may contain delimiters, parens, ports)

    Returns:
        List of dicts with keys: raw, token, kind
    """
    if not raw or not raw.strip():
        return []

    tokens_found = _split_and_parse(raw)
    result = []

    for token in tokens_found:
        # Classify and optionally generate additional atoms (port head, sheet number)
        atoms_for_token = _classify_and_expand_token(token)

        for atom_token in atoms_for_token:
            kind = _classify_kind(atom_token)
            result.append({"raw": raw, "token": atom_token, "kind": kind})

    return result


def atoms(raw: str) -> set[str]:
    """Return the set of atomic token strings from a reference.

    Args:
        raw: Compound reference string

    Returns:
        Set of normalized token strings
    """
    parsed = parse_ref(raw)
    return {a["token"] for a in parsed}


def expand_pool(tokens: list[str]) -> set[str]:
    """Union of normalized originals + normalized atoms.

    For each input token, parse it to extract atoms, then normalize all of them
    plus the original using grader._norm.

    Args:
        tokens: List of reference strings (may be compound)

    Returns:
        Set of normalized strings
    """
    result = set()

    for token_str in tokens:
        if not token_str or not token_str.strip():
            continue

        # Add normalized original
        norm_orig = _norm(token_str)
        if norm_orig:
            result.add(norm_orig)

        # Parse to atoms and add normalized atoms
        parsed = parse_ref(token_str)
        for atom in parsed:
            norm_atom = _norm(atom["token"])
            if norm_atom:
                result.add(norm_atom)

    return result


# ============================================================================
# Internal helpers


def _split_and_parse(raw: str) -> set[str]:
    """Split on delimiters and extract from parens recursively.

    Handles:
    - Delimiters: `;`, `,`, `<->`, `->`, ` / ` (space-surrounded slash)
    - Parenthesized content extracted recursively
    - Special handling for S<digits>/S<digits> sheet shorthand

    Returns set of tokens (whitespace stripped, empty dropped).
    """
    result = set()

    # First, extract all parenthesized content and recursively parse it
    content = raw
    while "(" in content:
        # Find innermost parens
        match = re.search(r"\(([^()]*)\)", content)
        if match:
            inner = match.group(1)
            # Recursively parse the interior
            inner_tokens = _split_and_parse(inner)
            result.update(inner_tokens)
            # Remove parens from content (leave space for splitting)
            content = content[:match.start()] + " " + content[match.end():]
        else:
            break

    # Now split content by delimiters
    # Order matters: handle longer delimiters first
    tokens = _split_by_delimiters(content)

    for token in tokens:
        token = token.strip()
        if not token:
            continue

        # Special case: S<digits>/S<digits> shorthand for sheets
        # This should be split on the / even though / normally doesn't split
        if re.match(r"^S\d+[a-z]?/S\d+[a-z]?$", token):
            sheet_parts = token.split("/")
            for part in sheet_parts:
                part = part.strip()
                if part:
                    result.add(part)
        else:
            result.add(token)

    return result


def _split_by_delimiters(text: str) -> list[str]:
    """Split by delimiters: `;`, list commas, `<->`, `->`, ` / `, whitespace.

    Handles ` / ` as a specific delimiter (space-surrounded slash).
    Bare `/` inside tokens is NOT a delimiter.
    A comma BETWEEN DIGITS is never a delimiter: it is the IEC/European
    decimal separator ("4G1,5" cross-sections, "4,7k" ratings, comma-locale
    "4,4" sheet refs) and splitting it would shear the designation this
    module exists to preserve.
    Whitespace also acts as a delimiter (multiple spaces, tabs, newlines).
    """
    pattern = r";|(?<!\d),|,(?!\d)|<->|->| / |\s+"
    parts = re.split(pattern, text)
    return parts


def _classify_and_expand_token(token: str) -> set[str]:
    """Generate atoms from a token, including port-head and sheet-number variants.

    Rules:
    - Device with :port suffix generates both full and head (without port)
    - sheet<NN> generates both 'sheet<NN>' and bare '<NN>'
    - Other tokens returned as-is
    """
    result = {token}

    # Rule 8 (real-output finding): EPLAN off-page shorthand writes a leading
    # slash before a sheet.column ref ("/20.4"). Strip bare EDGE slashes so
    # the atom matches the plain designation; interior slashes ("-3/F1",
    # "+CAB2/5.3") are untouched.
    stripped = token.strip("/")
    if stripped and stripped != token:
        result.add(stripped)

    # Rule 5: Device with :port -> also yield head
    if ":" in token and token.startswith("-"):
        # Device with port: -21/A13:24VDC -> also add -21/A13
        head = token.split(":")[0]
        result.add(head)

    # Rule 4: sheet<NN> -> also yield bare number
    match = re.match(r"^sheet(\d+[a-z]?)$", token, re.IGNORECASE)
    if match:
        bare_num = match.group(1)
        result.add(bare_num)

    return result


def _classify_kind(token: str) -> str:
    """Classify token into a kind: sheet_col|assembly|device|sheet|signal|unknown.

    Grammar rule 6:
    - sheet_col = \\d+[a-z]?\\.\\d+
    - assembly = starts with +
    - device = starts with -
    - sheet = S\\d+[a-z]? or bare number from rule 4
    - signal = contains letter, not device/assembly
    - else unknown
    """
    if not token:
        return "unknown"

    # Check sheet_col: \d+[a-z]?\.\d+
    if re.match(r"^\d+[a-z]?\.\d+$", token):
        return "sheet_col"

    # Check assembly (starts with +)
    if token.startswith("+"):
        return "assembly"

    # Check device (starts with -)
    if token.startswith("-"):
        return "device"

    # Check sheet: S\d+[a-z]? pattern or sheet<NN> (case-insensitive)
    if re.match(r"^S\d+[a-z]?$", token, re.IGNORECASE):
        return "sheet"

    if re.match(r"^sheet\d+[a-z]?$", token, re.IGNORECASE):
        return "sheet"

    # Check bare sheet number (from rule 4: sheet<NN> -> <NN>)
    if re.match(r"^\d+[a-z]?$", token):
        return "sheet"

    # Check signal: contains letter, not device/assembly
    if any(c.isalpha() for c in token):
        return "signal"

    # Default: unknown
    return "unknown"
