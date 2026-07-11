#!/usr/bin/env python3
"""
Static security checker for knowledge_entries read filters.

Enforces `.claude/rules/knowledge-entries-tenant-scoping.md` (the law):
- HYBRID surfaces must filter: (is_private = false OR tenant_id = $caller)
- PUBLIC-ONLY surfaces (OEM rollups) need no tenant filter
- TENANT-ONLY surfaces must be allowlisted (they hide OEM corpus)
- UNFILTERED reads must be allowlisted (cross-tenant leak risk)

Run: python tools/qa/security/check_knowledge_entries_filters.py [--fix]
"""

import re
import sys
import yaml
from pathlib import Path
from typing import Optional, TypedDict


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
    ke_pattern = re.compile(
        r"(?:FROM|JOIN|,\s*)\s+knowledge_entries\b",
        re.IGNORECASE
    )

    # Search TypeScript and Python files
    for pattern in ["**/*.ts", "**/*.py"]:
        for file_path in repo_root.glob(pattern):
            # Skip node_modules, .next, test files we don't care about
            if any(part in str(file_path) for part in [
                "node_modules", ".next", "dist", "__pycache__", ".venv"
            ]):
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

                    reads.append({
                        "file": str(file_path.relative_to(repo_root)),
                        "line_num": i + 1,
                        "query": query_context.strip(),
                        "classification": classification,
                        "reason": reason,
                    })

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
        r"WHERE\s+(.*?)(?:GROUP BY|ORDER BY|LIMIT|;|$)",
        query,
        re.IGNORECASE | re.DOTALL
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
        "is_private = false" in where_lower or
        "is_private is false" in where_lower or
        "is_private is not true" in where_lower or
        "is_private=false" in where_lower
    )

    has_tenant_filter = (
        "tenant_id" in where_lower and
        ("=" in where_lower or "in" in where_lower)
    )

    has_is_private_true = (
        "is_private = true" in where_lower or
        "is_private is true" in where_lower
    )

    # HYBRID: Both is_private=false AND tenant_id filter (with OR between them)
    has_hybrid_pattern = (
        re.search(
            r"\(?\s*is_private\s*(?:=|is)\s*false.*?OR.*?tenant_id\s*[=in].*?\)?",
            where_lower,
            re.DOTALL
        ) or
        re.search(
            r"\(?\s*tenant_id\s*[=in].*?OR.*?is_private\s*(?:=|is)\s*false.*?\)?",
            where_lower,
            re.DOTALL
        )
    )

    if has_hybrid_pattern:
        return "HYBRID", "Contains (is_private = false OR tenant_id = ...) pattern"

    if has_is_private_false and not has_tenant_filter:
        return "PUBLIC-ONLY", "Only filters on is_private = false (OEM corpus)"

    if has_tenant_filter and not has_is_private_false and not has_is_private_true:
        return "TENANT-ONLY", f"Only filters on tenant_id without is_private = false (bug class #1761)"

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


def check_reads(reads: list[ReadSite], allowlist: dict) -> tuple[list[str], int]:
    """
    Check reads against the law and allowlist.

    Returns: (error messages, exit code)
    """
    errors = []
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

    # Check for stale allowlist entries (files that no longer read knowledge_entries)
    current_keys = {f"{r['file']}:{r['line_num']}" for r in reads}
    for allowlist_key in allowlist_entries:
        if allowlist_key not in current_keys:
            # Could be a moved line or removed code — just warn
            errors.append(
                f"⚠️  {allowlist_key} - Allowlist entry not found in code\n"
                f"   Note: The file or line may have been moved/deleted"
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
            template += f"  \"{key}\":\n"
            template += f"    approved_classification: {read['classification']}\n"
            template += f"    reason: \"TODO: justify this read pattern\"\n"
            template += f"    query_snippet: |\n"
            for line in read["query"].split("\n")[:3]:
                template += f"      {line}\n"

    return template


def main():
    """Main entry point."""
    repo_root = Path(__file__).parent.parent.parent.parent
    allowlist_path = repo_root / "tools" / "qa" / "security" / "knowledge_entries_read_allowlist.yml"

    print(f"Scanning {repo_root} for knowledge_entries reads...", file=sys.stderr)
    reads = find_knowledge_entries_reads(repo_root)
    print(f"Found {len(reads)} knowledge_entries read sites", file=sys.stderr)

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
        template = generate_allowlist_template([r for r in reads if r["classification"] not in ["HYBRID", "PUBLIC-ONLY"]])
        if "--generate" in sys.argv:
            allowlist_path.write_text(template)
            print(f"Generated allowlist template at {allowlist_path}", file=sys.stderr)
        else:
            print(f"\nTo generate allowlist template, run: python {Path(__file__).name} --generate", file=sys.stderr)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
