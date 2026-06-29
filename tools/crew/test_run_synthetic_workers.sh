#!/usr/bin/env bash
# test_run_synthetic_workers.sh — hermetic tests for the synthetic-worker runner.
# Shims `gh` (no network, no real issues) and uses deterministic fake scenarios
# in a temp dir with --dry-run. Run: bash tools/crew/test_run_synthetic_workers.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$HERE/run_synthetic_workers.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── shim gh: empty dedupe + fake create URL ──────────────────────────────────
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "issue" && "${2:-}" == "list" ]]; then exit 0; fi
if [[ "${1:-}" == "issue" && "${2:-}" == "create" ]]; then echo "https://github.com/Mikecranesync/MIRA/issues/99999"; exit 0; fi
exit 0
SH
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export OUT_DIR="$TMP/out"

# ── deterministic fake scenarios ─────────────────────────────────────────────
SCN="$TMP/scenarios"; mkdir -p "$SCN"
common() { # $1=file extra=stdin
  cat > "$SCN/$1.scenario"
}
cat > "$SCN/good.scenario" <<'S'
SCN_SUMMARY="good"; SCN_TITLE="P2(hub): good finding"; SCN_LABELS="bug,hub,dogfood,needs-triage"
SCN_SEVERITY="P2"; SCN_FINDER="carlos"; SCN_VERIFIER="dana"; SCN_DEDUPE="good finding terms"
SCN_NOT_SHARED="caller's own tenant object"; SCN_EVIDENCE="HTTP 500 + log line"
SCN_REPRO_CMD='echo SIGNAL_OK'; SCN_REPRO_EXPECT="SIGNAL_OK"; SCN_NARRATIVE="n"
S
cat > "$SCN/norepro.scenario" <<'S'
SCN_SUMMARY="norepro"; SCN_TITLE="P2(hub): not reproducible"; SCN_LABELS="bug,dogfood"
SCN_SEVERITY="P2"; SCN_FINDER="carlos"; SCN_VERIFIER="dana"; SCN_DEDUPE="x"
SCN_NOT_SHARED="x"; SCN_EVIDENCE="x"; SCN_REPRO_CMD='echo nothing-here'; SCN_REPRO_EXPECT="SIGNAL_OK"
S
cat > "$SCN/self.scenario" <<'S'
SCN_SUMMARY="self"; SCN_TITLE="P2(hub): self verified"; SCN_LABELS="security,dogfood"
SCN_SEVERITY="P2"; SCN_FINDER="ivy"; SCN_VERIFIER="ivy"; SCN_DEDUPE="x"
SCN_NOT_SHARED="x"; SCN_EVIDENCE="x"; SCN_REPRO_CMD='echo SIGNAL_OK'; SCN_REPRO_EXPECT="SIGNAL_OK"
S
cat > "$SCN/p0.scenario" <<'S'
SCN_SUMMARY="p0"; SCN_TITLE="P0(hub): big one"; SCN_LABELS="security,dogfood"
SCN_SEVERITY="P0"; SCN_FINDER="ivy"; SCN_VERIFIER="dana"; SCN_DEDUPE="x"
SCN_NOT_SHARED="x"; SCN_EVIDENCE="x"; SCN_REPRO_CMD='echo SIGNAL_OK'; SCN_REPRO_EXPECT="SIGNAL_OK"
S
cat > "$SCN/badlabels.scenario" <<'S'
SCN_SUMMARY="badlabels"; SCN_TITLE="P2(hub): no dogfood label"; SCN_LABELS="bug,needs-triage"
SCN_SEVERITY="P2"; SCN_FINDER="carlos"; SCN_VERIFIER="dana"; SCN_DEDUPE="x"
SCN_NOT_SHARED="x"; SCN_EVIDENCE="x"; SCN_REPRO_CMD='echo SIGNAL_OK'; SCN_REPRO_EXPECT="SIGNAL_OK"
S

PASS=0; FAIL=0
assert() { # $1=name $2=needle $3=output
  if printf '%s' "$3" | grep -qF "$2"; then echo "PASS: $1"; PASS=$((PASS+1))
  else echo "FAIL: $1 — expected '$2'"; printf '%s\n' "$3" | awk '{print "    " $0}'; FAIL=$((FAIL+1)); fi
}

# Run scenarios one at a time, dry-run (default). Assert on the stable, bracketed
# per-scenario echo lines (whitespace-independent).
g="$(bash "$RUNNER" --scenario good     --scenario-dir "$SCN" --dry-run 2>&1)"
assert "good → WOULD-FILE"        "[good] WOULD-FILE"        "$g"
# Prove create_issue.sh's gate actually ran + passed (it logs per-scenario).
assert "good → create_issue gate passed" "Verification gate PASSED" "$(cat "$OUT_DIR/good.create_issue.log" 2>/dev/null)"

n="$(bash "$RUNNER" --scenario norepro  --scenario-dir "$SCN" --dry-run 2>&1)"
assert "norepro → refused"            "[norepro] REFUSED — did not reproduce" "$n"
if printf '%s' "$n" | grep -q "Verification gate PASSED"; then echo "FAIL: norepro should NOT reach the gate"; FAIL=$((FAIL+1)); else echo "PASS: norepro never reached the gate"; PASS=$((PASS+1)); fi

s="$(bash "$RUNNER" --scenario self     --scenario-dir "$SCN" --dry-run 2>&1)"
assert "self → refused self-verify"   "[self] REFUSED — self-verification" "$s"

p="$(bash "$RUNNER" --scenario p0       --scenario-dir "$SCN" --dry-run 2>&1)"
assert "p0 (no flag) → refused"       "[p0] REFUSED — P0 severity requires --allow-p0" "$p"
pa="$(bash "$RUNNER" --scenario p0 --allow-p0 --scenario-dir "$SCN" --dry-run 2>&1)"
assert "p0 (--allow-p0) → WOULD-FILE" "[p0] WOULD-FILE" "$pa"

b="$(bash "$RUNNER" --scenario badlabels --scenario-dir "$SCN" --dry-run 2>&1)"
assert "badlabels → refused labels"   "[badlabels] REFUSED — labels must include dogfood/crew" "$b"

# Summary line present
assert "summary printed" "== summary ==" "$g"

# --list works
l="$(bash "$RUNNER" --scenario-dir "$SCN" --list 2>&1)"
assert "--list shows good summary" "good" "$l"

# FILE mode actually calls the (shimmed) gh create for the good scenario
fmode="$(bash "$RUNNER" --scenario good --scenario-dir "$SCN" --file-issues 2>&1)"
assert "file-issues → FILED url" "[good] FILED" "$fmode"
assert "file-issues → shimmed url" "issues/99999" "$fmode"

echo "──────────────"
echo "RESULT: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
