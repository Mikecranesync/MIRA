#!/usr/bin/env python3
"""
Static security checker for knowledge_entries read filters.

Enforces `.claude/rules/knowledge-entries-tenant-scoping.md` (the law):
- HYBRID surfaces must filter: (is_private = false OR tenant_id = $caller)
- PUBLIC-ONLY surfaces (OEM rollups) need no tenant filter
- TENANT-ONLY surfaces must be allowlisted (they hide OEM corpus)
- UNFILTERED reads must be allowlisted (cross-tenant leak risk)

Run: python tools/qa/security/check_knowledge_entries_filters.py
     [--generate | --backfill-hashes]
"""

import hashlib
import re
import sys
from pathlib import Path
from typing import TypedDict

import yaml


class ReadSite(TypedDict):
    file: str
    line_num: int
    query: str
    classification: str
    reason: str


def find_knowledge_entries_reads(repo_root: Path) -> list[ReadSite]:
    """Scan repo for SQL reading knowledge_entries and classify each."""
    reads: list[ReadSite] = []

    # Patterns that indicate a read from knowledge_entries
    # Match: FROM knowledge_entries, JOIN knowledge_entries, etc.
    ke_pattern = re.compile(r"(?:FROM|JOIN|,\s*)\s+knowledge_entries\b", re.IGNORECASE)

    # Search TypeScript and Python files
    for pattern in ["**/*.ts", "**/*.py"]:
        for file_path in repo_root.glob(pattern):
            relative_path = file_path.relative_to(repo_root).as_posix()
            # Skip node_modules, .next, test files we don't care about
            if any(
                part in relative_path
                for part in [
                    "node_modules",
                    ".next",
                    "dist",
                    "__pycache__",
                    ".venv",
                    # the checker and its fixtures contain pattern strings, not reads
                    "tools/qa/security/check_knowledge_entries_filters.py",
                    "tests/test_knowledge_entries_security_check.py",
                ]
            ):
                continue

            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue

            lines = content.split("\n")

            # Find lines that reference knowledge_entries
            for i, line in enumerate(lines):
                if ke_pattern.search(line):
                    # Extract the query context (this is a heuristic)
                    query_context = _extract_query_context(lines, i)
                    classification, reason = _classify_read(query_context)
                    if classification in ("UNFILTERED", "TENANT-ONLY"):
                        composed = _classify_composed_filter(query_context, lines)
                        if composed:
                            classification, reason = composed

                    reads.append(
                        {
                            "file": relative_path,
                            "line_num": i + 1,
                            "query": query_context.strip(),
                            "classification": classification,
                            "reason": reason,
                        }
                    )

    return reads


def _extract_query_context(lines: list[str], start_idx: int) -> str:
    """Extract SQL query context around the knowledge_entries reference."""
    context = []

    # Look backwards for START of query (SELECT, WITH, etc.)
    start = start_idx
    for i in range(start_idx, max(-1, start_idx - 50), -1):
        line = lines[i].strip()
        if re.search(r"^(SELECT|WITH|FROM|INSERT|UPDATE|DELETE)", line, re.IGNORECASE):
            start = i
            break

    # Look forwards for END of query (;, EOF, or pattern breaks)
    end = start_idx + 1
    for i in range(start_idx + 1, min(len(lines), start_idx + 100)):
        line = lines[i].strip()
        if ";" in line or (line and not line.startswith("|") and not line.startswith("*")):
            end = i + 1
            if ";" in line:
                break

    context = "\n".join(lines[start:end])
    return context


_COMPOSED_HYBRID_BRANCH = "(is_private = false OR tenant_id = :tid)"
_COMPOSED_PUBLIC_BRANCH = '"is_private = false"'


def _classify_composed_filter(query: str, lines: list[str]) -> tuple[str, str] | None:
    """Resolve the dynamically-composed tenant_filter pattern (neon_recall.py).

    A query interpolating `{tenant_filter}` is HYBRID iff the SAME file assigns
    BOTH canonical branches of the hybrid law:
        tenant_filter = "(is_private = false OR tenant_id = :tid)"   # tenant branch
        tenant_filter = "is_private = false"                          # anonymous branch
    Exact-string match, file-scoped — deterministic, no allowlist entry needed.
    Anything else stays UNFILTERED/TENANT-ONLY and must be allowlisted.
    """
    if "{tenant_filter}" not in query:
        return None
    text = "\n".join(lines)
    if _COMPOSED_HYBRID_BRANCH in text and _COMPOSED_PUBLIC_BRANCH in text:
        return (
            "HYBRID",
            "Composed tenant_filter: file assigns both hybrid-law branches "
            "((is_private = false OR tenant_id = :tid) | is_private = false)",
        )
    return None


def _classify_read(query: str) -> tuple[str, str]:
    """
    Classify a knowledge_entries read as HYBRID, PUBLIC-ONLY, TENANT-ONLY, or UNFILTERED.

    Returns: (classification, reason)
    """
    query_lower = query.lower()

    # Check if it's even selecting from knowledge_entries
    if "knowledge_entries" not in query_lower:
        return "UNKNOWN", "No knowledge_entries reference found"

    # Extract WHERE clause (simplified regex)
    where_match = re.search(
        r"WHERE\s+(.*?)(?:GROUP BY|ORDER BY|LIMIT|;|$)", query, re.IGNORECASE | re.DOTALL
    )

    if not where_match:
        where_clause = ""
    else:
        where_clause = where_match.group(1).strip()

    if not where_clause:
        return "UNFILTERED", "No WHERE clause on knowledge_entries read"

    where_lower = where_clause.lower()

    # Detect patterns
    has_is_private_false = (
        "is_private = false" in where_lower
        or "is_private is false" in where_lower
        or "is_private is not true" in where_lower
        or "is_private=false" in where_lower
    )

    has_tenant_filter = "tenant_id" in where_lower and ("=" in where_lower or "in" in where_lower)

    has_is_private_true = "is_private = true" in where_lower or "is_private is true" in where_lower

    # HYBRID: Both is_private=false AND tenant_id filter (with OR between them)
    has_hybrid_pattern = re.search(
        r"\(?\s*is_private\s*(?:=|is)\s*false.*?OR.*?tenant_id\s*[=in].*?\)?",
        where_lower,
        re.DOTALL,
    ) or re.search(
        r"\(?\s*tenant_id\s*[=in].*?OR.*?is_private\s*(?:=|is)\s*false.*?\)?",
        where_lower,
        re.DOTALL,
    )

    if has_hybrid_pattern:
        return "HYBRID", "Contains (is_private = false OR tenant_id = ...) pattern"

    if has_is_private_false and not has_tenant_filter:
        return "PUBLIC-ONLY", "Only filters on is_private = false (OEM corpus)"

    if has_tenant_filter and not has_is_private_false and not has_is_private_true:
        return (
            "TENANT-ONLY",
            "Only filters on tenant_id without is_private = false (bug class #1761)",
        )

    if has_is_private_true:
        return "PRIVATE-ONLY", "Filters only on is_private = true (private uploads only)"

    if has_tenant_filter and has_is_private_false:
        return "HYBRID", "Contains both is_private = false and tenant_id filter"

    return "UNFILTERED", f"WHERE clause does not match known safe patterns: {where_clause[:100]}"


def load_allowlist(allowlist_path: Path) -> dict:
    """Load the allowlist of approved read sites."""
    if not allowlist_path.exists():
        return {}

    try:
        content = allowlist_path.read_text(encoding="utf-8")
        return yaml.safe_load(content) or {}
    except Exception as e:
        print(f"Error loading allowlist: {e}", file=sys.stderr)
        return {}


def _normalize_query_context(text) -> str:
    """Normalize the full query context for hashing and readable evidence."""
    return " ".join(" ".join(line.split()) for line in str(text or "").splitlines() if line.strip())


def context_sha256(file: str, query) -> str:
    """The security discriminator: a stable hash of the read's FULL normalized
    context, salted with the read's source path.

    Why a hash of the whole context — not `query_snippet`, not its first line:
    the allowlist key is `file:line`, which slides onto a NEIGHBOUR when lines are
    inserted or deleted above a read. A first-line (or short-prefix) comparison
    cannot tell two reads apart when they share a first line — and many real
    entries begin `FROM knowledge_entries`, so a neighbour's approval was silently
    accepted for a different query (#3053). Hashing the ENTIRE normalized context
    distinguishes reads by their WHERE/JOIN wherever it sits; folding the source
    `file` into the input means two identical short contexts in different files
    cannot collide either. `query_snippet` stays in the allowlist purely as
    human-readable evidence and is NEVER compared.
    """
    canonical = f"{file}\n{_normalize_query_context(query)}"
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _approval_matches(entry: dict, read) -> bool:
    """Does the approval at this file:line key actually cover the query now there?

    The discriminator is `query_sha256` (the full-context hash). Missing and
    mismatched hashes both fail closed; the live entries were backfilled by the
    migration in #3053 and the template writes one for every new entry.
    """
    approved_hash = entry.get("query_sha256")
    return bool(approved_hash) and approved_hash == context_sha256(read["file"], read["query"])


def check_reads(reads: list[ReadSite], allowlist: dict) -> tuple[list[str], int]:
    """
    Check reads against the law and allowlist.

    Returns: (error messages, exit code)
    """
    errors = []
    pending_justification = 0
    allowlist_entries = allowlist.get("approved", {})

    for read in reads:
        key = f"{read['file']}:{read['line_num']}"
        classification = read["classification"]

        # TENANT-ONLY and UNFILTERED must be explicitly allowlisted
        if classification in ["TENANT-ONLY", "UNFILTERED"]:
            if key not in allowlist_entries:
                errors.append(
                    f"❌ {key} - {classification}\n"
                    f"   Reason: {read['reason']}\n"
                    f"   Query: {read['query'][:100]}...\n"
                    f"   Action: Add to allowlist with justification, or fix the query"
                )
            else:
                entry = allowlist_entries[key]
                if entry.get("approved_classification") != classification:
                    errors.append(
                        f"⚠️  {key} - Classification mismatch\n"
                        f"   Expected: {entry.get('approved_classification')}\n"
                        f"   Found: {classification}\n"
                        f"   Note: The read pattern may have changed"
                    )
                elif not entry.get("query_sha256"):
                    errors.append(
                        f"⚠️  {key} - Approval is missing query_sha256\n"
                        "   Note: an approval without the full-context discriminator "
                        "cannot be verified\n"
                        "   Action: run --backfill-hashes, then RE-READ the query "
                        "before approving it"
                    )
                elif not _approval_matches(entry, read):
                    errors.append(
                        f"⚠️  {key} - Approval is attached to a DIFFERENT query\n"
                        f"   Approved:  {_normalize_query_context(entry.get('query_snippet'))[:120]}\n"
                        f"   Found:     {_normalize_query_context(read['query'])[:120]}\n"
                        f"   Approved hash: {str(entry.get('query_sha256'))[:12]}…  "
                        f"Found hash: {context_sha256(read['file'], read['query'])[:12]}…\n"
                        f"   Note: keys are file:line, so inserting or deleting lines above a\n"
                        f"         read slides it onto a NEIGHBOUR's approved line. The\n"
                        f"         classification still matches, but the full-context hash no\n"
                        f"         longer does — so the misattributed approval is caught.\n"
                        f"   Action: re-key the entry and RE-READ the query before approving it"
                    )
                elif "TODO" in str(entry.get("reason", "")):
                    # enumerated debt, not approval — non-fatal but counted
                    pending_justification += 1

    # Check for stale allowlist entries (files that no longer read knowledge_entries)
    current_keys = {f"{r['file']}:{r['line_num']}" for r in reads}
    for allowlist_key in allowlist_entries:
        if allowlist_key not in current_keys:
            # Could be a moved line or removed code — just warn
            errors.append(
                f"⚠️  {allowlist_key} - Allowlist entry not found in code\n"
                f"   Note: The file or line may have been moved/deleted"
            )

    if pending_justification:
        print(
            f"⏳ {pending_justification} allowlisted site(s) still carry a TODO reason — "
            "enumerated debt, tracked in the seeding follow-up issue (non-fatal)",
            file=sys.stderr,
        )

    exit_code = 0 if not errors else 1
    return errors, exit_code


def generate_allowlist_template(reads: list[ReadSite]) -> str:
    """Generate an allowlist template based on found reads."""
    template = "# knowledge_entries read-site allowlist\n"
    template += "# See .claude/rules/knowledge-entries-tenant-scoping.md\n"
    template += "#\n"
    template += "# HYBRID = correct (contains is_private = false OR tenant_id = ...)\n"
    template += "# PUBLIC-ONLY = correct for OEM rollup surfaces (no tenant filter)\n"
    template += "# TENANT-ONLY = must be allowlisted with reason (hides OEM corpus)\n"
    template += "# UNFILTERED = must be allowlisted with reason (cross-tenant leak risk)\n"
    template += "#\n\n"
    template += "approved:\n"

    for read in reads:
        if read["classification"] not in ["HYBRID", "PUBLIC-ONLY"]:
            key = f"{read['file']}:{read['line_num']}"
            template += f'  "{key}":\n'
            template += f"    approved_classification: {read['classification']}\n"
            template += '    reason: "TODO: justify this read pattern"\n'
            # query_sha256 is the security discriminator (full-context hash, source
            # salted). query_snippet below is human-readable evidence ONLY.
            template += f'    query_sha256: "{context_sha256(read["file"], read["query"])}"\n'
            template += "    query_snippet: |\n"
            for line in read["query"].split("\n"):
                template += f"      {line}\n"

    return template


def backfill_query_sha256(allowlist_path: Path, reads: list) -> int:
    """Insert `query_sha256` for every `approved:` entry whose file:line maps to a
    live read, computing the hash the checker will compute. Preserves all comments,
    ordering, and other review metadata (reason, classification, snippet). Idempotent
    — skips an entry that already carries a hash. Returns the number added.

    This is the migration that makes the new discriminator real for the entries the
    old first-line matcher approved (analogous to `apply-migrations mode=seed-ledger`).
    """
    read_by_key = {f"{r['file']}:{r['line_num']}": r for r in reads}
    lines = allowlist_path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    in_approved = False
    current_key = None
    current_entry_start = None
    added = 0
    key_re = re.compile(r'^  "(.+)":\s*$')
    for idx, line in enumerate(lines):
        if line == "approved:":
            in_approved = True
        m = key_re.match(line)
        if m:
            current_key = m.group(1)
            current_entry_start = idx
        out.append(line)
        if (
            in_approved
            and current_key
            and current_entry_start is not None
            and line.startswith("    approved_classification:")
        ):
            block_end = idx + 1
            while block_end < len(lines) and not key_re.match(lines[block_end]):
                block_end += 1
            if any(
                candidate.startswith("    query_sha256:")
                for candidate in lines[current_entry_start + 1 : block_end]
            ):
                continue  # idempotent: already backfilled
            read = read_by_key.get(current_key)
            if read is not None:
                out.append(f'    query_sha256: "{context_sha256(read["file"], read["query"])}"')
                added += 1
    allowlist_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return added


def main():
    """Main entry point."""
    repo_root = Path(__file__).parent.parent.parent.parent
    allowlist_path = (
        repo_root / "tools" / "qa" / "security" / "knowledge_entries_read_allowlist.yml"
    )

    print(f"Scanning {repo_root} for knowledge_entries reads...", file=sys.stderr)
    reads = find_knowledge_entries_reads(repo_root)
    print(f"Found {len(reads)} knowledge_entries read sites", file=sys.stderr)

    if "--backfill-hashes" in sys.argv:
        added = backfill_query_sha256(allowlist_path, reads)
        print(f"Backfilled query_sha256 for {added} approved entries.", file=sys.stderr)

    # Classify and check
    allowlist = load_allowlist(allowlist_path)
    errors, exit_code = check_reads(reads, allowlist)

    # Print results
    if errors:
        print("\n" + "\n".join(errors))
        print(f"\n❌ Found {len(errors)} issue(s) with knowledge_entries reads", file=sys.stderr)
    else:
        print("✅ All knowledge_entries reads are properly classified", file=sys.stderr)

    # If no allowlist exists, generate template
    if not allowlist_path.exists() or "--generate" in sys.argv:
        template = generate_allowlist_template(
            [r for r in reads if r["classification"] not in ["HYBRID", "PUBLIC-ONLY"]]
        )
        if "--generate" in sys.argv:
            allowlist_path.write_text(template)
            print(f"Generated allowlist template at {allowlist_path}", file=sys.stderr)
        else:
            print(
                f"\nTo generate allowlist template, run: python {Path(__file__).name} --generate",
                file=sys.stderr,
            )

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
