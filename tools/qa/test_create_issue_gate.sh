#!/usr/bin/env bash
# test_create_issue_gate.sh — proves the adversarial-verification gate in
# create_issue.sh. Hermetic: shims `gh` so NO real GitHub call is made, and uses
# --dry-run so nothing is ever created. Run: bash tools/qa/test_create_issue_gate.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/create_issue.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── shim gh: empty dedupe list + a fake create URL; no network ───────────────
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "issue" && "${2:-}" == "list" ]]; then exit 0; fi      # no dupes
if [[ "${1:-}" == "issue" && "${2:-}" == "create" ]]; then
  echo "https://github.com/Mikecranesync/MIRA/issues/99999"; exit 0
fi
exit 0
SH
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"

# ── fixtures ─────────────────────────────────────────────────────────────────
GOOD="$TMP/good.md"; cat > "$GOOD" <<'MD'
# Finding: enrich 500

Reproduces: yes — curl POST returned 500 twice
Not expected shared/public data: yes — caller's own tenant object, not the OEM corpus
Severity justified: yes — P1
Deduped: yes — searched "enrich grant"; no existing match
Evidence sufficient: yes — server log "permission denied for table asset_enrichment_reports"
Found by: dana
Verified by: opus-verifier
MD

MISSING="$TMP/missing.md"; cat > "$MISSING" <<'MD'
# Finding
Something looked broken, P0 probably.
MD

SELF="$TMP/self.md"; cat > "$SELF" <<'MD'
# Finding
Reproduces: yes — reproduced
Not expected shared/public data: yes — own tenant
Severity justified: yes — P2
Deduped: yes — searched
Evidence sufficient: yes — HTTP 200 vs 404
Found by: ivy
Verified by: ivy
MD

PLAIN="$TMP/plain.md"; printf '# Manual issue\nA human-filed bug, no gate expected.\n' > "$PLAIN"

# ── harness ──────────────────────────────────────────────────────────────────
PASS=0; FAIL=0
run() { # $1=name  $2=expected_exit  $3=expect_substr (in combined output)  ; rest=args
  local name="$1" exp="$2" needle="$3"; shift 3
  local out rc
  out="$(bash "$SCRIPT" "$@" 2>&1)"; rc=$?
  if [[ "$rc" -eq "$exp" ]] && { [[ -z "$needle" ]] || printf '%s' "$out" | grep -qF "$needle"; }; then
    echo "PASS: $name (exit $rc)"; PASS=$((PASS+1))
  else
    echo "FAIL: $name — expected exit $exp + '$needle', got exit $rc"; echo "----"; printf '%s\n' "$out" | sed 's/^/    /'; echo "----"; FAIL=$((FAIL+1))
  fi
}

# 1. dogfood + missing fields → fail closed (exit 3) with the gate message
run "dogfood missing fields → refused" 3 "Refusing to file dogfood issue" \
  --title "P1(hub): test missing" --labels "bug,dogfood" --body-file "$MISSING" --dry-run

# 2. dogfood + finder==verifier → fail closed (exit 3)
run "dogfood self-verified → refused" 3 "must differ from" \
  --title "P2(hub): test self" --labels "security,dogfood" --body-file "$SELF" --dry-run

# 3. dogfood + all fields + finder!=verifier → succeeds (gate PASSED, dry-run exit 0)
run "dogfood fully verified → allowed" 0 "Verification gate PASSED" \
  --title "P1(hub): test good" --labels "bug,dogfood" --body-file "$GOOD" --dry-run

# 4. non-dogfood manual filing → unchanged, no gate (exit 0), no gate output
run "non-dogfood manual → ungated" 0 "DRY-RUN" \
  --title "P3(hub): plain manual" --labels "bug,needs-triage" --body-file "$PLAIN" --dry-run

# 5. (bonus) --require-verification forces the gate even without dogfood label
run "force-flag on plain body → refused" 3 "Refusing to file dogfood issue" \
  --title "P3(hub): forced" --labels "bug,needs-triage" --body-file "$PLAIN" --require-verification --dry-run

# 6. (bonus) dogfood with NO body-file → fail closed
run "dogfood no body-file → refused" 3 "no --body-file" \
  --title "P3(hub): nobody" --labels "dogfood" --dry-run

# 7. (bonus) non-dogfood manual must NOT print the gate-passed line
out7="$(bash "$SCRIPT" --title "x" --labels "bug" --body-file "$PLAIN" --dry-run 2>&1)"
if printf '%s' "$out7" | grep -q "Verification gate"; then
  echo "FAIL: non-dogfood unexpectedly ran the gate"; FAIL=$((FAIL+1))
else
  echo "PASS: non-dogfood does not run the gate"; PASS=$((PASS+1))
fi

echo "──────────────"
echo "RESULT: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
