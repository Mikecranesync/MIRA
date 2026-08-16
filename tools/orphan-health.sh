#!/usr/bin/env bash
# tools/orphan-health.sh — DETECTION ONLY report for leaked hook orphans and
# stale Claude sessions.
#
# Reports the two failure modes behind the CHARLIE thrashing incidents of
# 2026-08-03 and 2026-08-15 (see wiki/references/dev-loop.md § "Do not simplify
# the perl alarm wrapper"):
#
#   1. Orphaned `pyright` processes (PPID=1). A bare `pyright` in the
#      PostToolUse hook survives its shell, reparents to PID 1, and its
#      self-rescheduling node event loop never exits.
#   2. Claude sessions started BEFORE the last commit that changed
#      .claude/settings.json. Claude Code reads settings at session start and
#      caches them — it never re-reads. So a merged hook fix does NOT reach a
#      running session, and each stale session keeps leaking one orphan per
#      Edit/Write until it is restarted.
#
# Finding 2 is the one that makes this script worth having: on 2026-08-15 a
# fix that merged on 2026-08-09 was still producing orphans, because two
# sessions from 2026-07-28 were still alive running the pre-fix hook.
#
# ⚠️ THIS SCRIPT NEVER KILLS, SIGNALS, OR MODIFIES ANYTHING.
# That is deliberate. Killing a *session* destroys live work, and the operator
# is the only one who knows whether a long-running session is mid-task. A human
# reads this and decides. The orphan-kill command is printed, not executed.
#
# Always exits 0 so a cron/launchd line like `orphan-health.sh && something` is
# never broken by a finding. Use --strict to exit 1 when findings exist.
#
# Usage:
#   tools/orphan-health.sh                    # report
#   tools/orphan-health.sh --strict           # exit 1 if any finding (for CI/cron)
#   MIRA_ORPHAN_MIN_AGE_SECS=120 tools/...    # override the orphan age floor (default 60)

set -u

MIN_AGE="${MIRA_ORPHAN_MIN_AGE_SECS:-60}"
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || { echo "orphan-health: cannot cd to $REPO_ROOT"; exit 0; }

FINDINGS=0
NOW="$(date +%s)"

note() { FINDINGS=$((FINDINGS + 1)); printf '  %s\n' "$*"; }
info() { printf '  %s\n' "$*"; }

# macOS `ps` has no `-o etimes`, and `-o etime` formats as DD-HH:MM:SS /
# HH:MM:SS / MM:SS depending on age — a parsing bug farm. Convert `lstart`
# to an epoch instead, which is unambiguous at every age.
start_epoch() {
	local pid="$1" ls
	ls="$(ps -p "$pid" -o lstart= 2>/dev/null)"
	[ -n "$ls" ] || return 1
	# shellcheck disable=SC2001  # trailing whitespace trim, sed is clearest here
	ls="$(echo "$ls" | sed 's/[[:space:]]*$//')"
	date -j -f "%a %b %d %T %Y" "$ls" +%s 2>/dev/null
}

human_age() {
	local secs="$1"
	printf '%dd %dh %dm' $((secs / 86400)) $((secs % 86400 / 3600)) $((secs % 3600 / 60))
}

echo "orphan-health: $REPO_ROOT"
echo

# ---------------------------------------------------------------------------
# 1. Orphaned pyright processes
# ---------------------------------------------------------------------------
# Discriminator (proof-grade, not heuristic):
#   * The live language server is `node .../pyright-langserver --stdio` with a
#     real `claude` parent — a DIFFERENT command. Excluded by the regex below,
#     so a kill-by-PID from this report can never hit a live session.
#   * The post-fix hook wraps pyright in `perl -e 'alarm 45; exec @ARGV'`, and a
#     pending alarm() survives both exec and orphaning (verified: exit 142 /
#     SIGALRM after PPID->1). So a post-fix orphan self-terminates in ~45s.
#     Anything older than MIN_AGE cannot have come from the post-fix hook.
#   * The post-fix hook also guards `[ -n "$f" ] || exit 0` and execs
#     `pyright "$f"`, so a post-fix invocation ALWAYS carries a file argument.
#     A bare `pyright` with no argument is pre-fix by construction.
echo "[1] Orphaned pyright processes (PPID=1)"
ORPHANS=0
while read -r pid ppid args; do
	[ "$ppid" = "1" ] || continue
	case "$args" in
	*pyright-langserver*) continue ;;
	*/pyright | */pyright\ *) ;;
	*) continue ;;
	esac

	pe="$(start_epoch "$pid")" || continue
	age=$((NOW - pe))
	[ "$age" -ge "$MIN_AGE" ] || continue

	ORPHANS=$((ORPHANS + 1))
	rss="$(ps -p "$pid" -o rss= 2>/dev/null | tr -d ' ')"
	cpu="$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')"
	note "ORPHAN pid=$pid age=$(human_age "$age") cpu=${cpu}% rss=$((${rss:-0} / 1024))MB"
	info "         cmd: $args"
	case "$args" in
	*/pyright) info "         ^ no file argument — pre-fix hook form (scans the WHOLE project)" ;;
	esac
done < <(ps -Ao pid=,ppid=,command= 2>/dev/null)

if [ "$ORPHANS" -eq 0 ]; then
	info "none (nothing PPID=1 matching pyright older than ${MIN_AGE}s)"
else
	info ""
	info "To clear (SIGTERM is enough; the langservers are a different command"
	info "and are never at risk from an explicit-PID kill):"
	info "    kill -TERM <pid>"
fi
echo

# ---------------------------------------------------------------------------
# 2. Stale Claude sessions (running a cached, pre-fix hook config)
# ---------------------------------------------------------------------------
# Uses the last COMMIT that changed the settings file, not filesystem mtime: a
# `git checkout` that swaps the file out and back rewrites mtime twice, and any
# cosmetic edit would flag every running session.
echo "[2] Claude sessions older than the last .claude/settings.json change"
SET_EPOCH=""
SET_REF=""
for f in .claude/settings.json .claude/settings.local.json; do
	[ -e "$f" ] || continue
	e="$(git log -1 --format=%ct -- "$f" 2>/dev/null)"
	[ -n "$e" ] || continue
	if [ -z "$SET_EPOCH" ] || [ "$e" -gt "$SET_EPOCH" ]; then
		SET_EPOCH="$e"
		SET_REF="$f"
	fi
done

if [ -z "$SET_EPOCH" ]; then
	info "skipped — no committed history for .claude/settings*.json"
else
	info "settings last changed: $(date -r "$SET_EPOCH" '+%Y-%m-%d %H:%M:%S') ($SET_REF)"
	STALE=0
	while read -r pid ppid args; do
		case "$args" in
		claude | claude\ *) ;;
		*) continue ;;
		esac
		pe="$(start_epoch "$pid")" || continue
		[ "$pe" -lt "$SET_EPOCH" ] || continue
		STALE=$((STALE + 1))
		note "STALE SESSION pid=$pid ppid=$ppid started=$(date -r "$pe" '+%Y-%m-%d %H:%M') age=$(human_age $((NOW - pe)))"
	done < <(ps -Ao pid=,ppid=,command= 2>/dev/null)

	if [ "$STALE" -eq 0 ]; then
		info "none — every running session started after the last settings change"
	else
		info ""
		info "These cached the OLD hook config at start and never re-read it."
		info "Pulling main does NOT fix them. They must be RESTARTED, or each"
		info "keeps leaking one orphan per Edit/Write."
	fi
fi
echo

# ---------------------------------------------------------------------------
# 3. Memory pressure (informational context — never a finding)
# ---------------------------------------------------------------------------
echo "[3] Memory pressure (context only, not a finding)"
if sw="$(sysctl -n vm.swapusage 2>/dev/null)"; then
	info "swap: $sw"
fi
if free_pages="$(vm_stat 2>/dev/null | awk '/Pages free/{gsub(/\./,"",$3); print $3}')"; then
	pagesize="$(vm_stat 2>/dev/null | awk 'NR==1{gsub(/[^0-9]/,"",$8); print $8}')"
	[ -n "${pagesize:-}" ] && [ -n "${free_pages:-}" ] &&
		info "free: $((free_pages * pagesize / 1048576)) MB"
fi
info "(heavy swap + near-zero free is the SYMPTOM; an orphan above is the cause)"
echo

# ---------------------------------------------------------------------------
if [ "$FINDINGS" -eq 0 ]; then
	echo "orphan-health: OK — no findings."
else
	echo "orphan-health: $FINDINGS finding(s). Nothing was killed or changed."
fi

[ "$STRICT" -eq 1 ] && [ "$FINDINGS" -gt 0 ] && exit 1
exit 0
