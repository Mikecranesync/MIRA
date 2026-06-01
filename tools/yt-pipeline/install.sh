#!/bin/bash
set -euo pipefail

# YouTube content pipeline — install/uninstall on Bravo launchd
# Usage: ./install.sh [uninstall]
#
# Preflight checks:
#   - doppler installed and logged in
#   - python3.12 available
#   - ffmpeg available
#   - Repo path matches plist WorkingDirectory
#   - Required Doppler secrets present in factorylm/prd
#
# Install: copies plist to ~/Library/LaunchAgents/, loads with -w (persist on reboot)
# Uninstall: unloads, removes plist

COMMAND="${1:-install}"
PLIST_FILE="$(dirname "$0")/com.factorylm.yt-pipeline.plist"
LAUNCHAGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_NAME="com.factorylm.yt-pipeline"
INSTALLED_PLIST="${LAUNCHAGENTS_DIR}/${PLIST_NAME}.plist"

# Parse WorkingDirectory from plist (to validate repo path)
parse_working_dir() {
    grep -A 1 "<key>WorkingDirectory</key>" "$PLIST_FILE" | grep "<string>" | sed 's/.*<string>\(.*\)<\/string>.*/\1/'
}

EXPECTED_REPO_PATH="$(parse_working_dir)"

# Color output for clarity
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_pass() {
    printf "${GREEN}✓${NC} %s\n" "$1"
}

print_fail() {
    printf "${RED}✗${NC} %s\n" "$1"
}

print_warn() {
    printf "${YELLOW}!${NC} %s\n" "$1"
}

# Preflight checks
preflight_check() {
    local fail_count=0

    # Check doppler installed
    if ! command -v doppler &>/dev/null; then
        print_fail "doppler not found (install: brew install doppler)"
        ((fail_count++))
    else
        print_pass "doppler installed"
    fi

    # Check python3.12 available
    if ! command -v python3.12 &>/dev/null; then
        print_fail "python3.12 not found (brew install python@3.12; ensure /opt/homebrew/bin is in PATH)"
        ((fail_count++))
    else
        print_pass "python3.12 available"
    fi

    # Check ffmpeg available
    if ! command -v ffmpeg &>/dev/null; then
        print_fail "ffmpeg not found (brew install ffmpeg)"
        ((fail_count++))
    else
        print_pass "ffmpeg available"
    fi

    # Check repo path
    if [[ ! -d "${EXPECTED_REPO_PATH}" ]]; then
        print_fail "Repo path not found: ${EXPECTED_REPO_PATH}"
        print_fail "This plist is configured for ${EXPECTED_REPO_PATH}. Adjust the plist or move the repo."
        ((fail_count++))
    else
        print_pass "Repo path exists: ${EXPECTED_REPO_PATH}"
    fi

    # Check doppler logged in
    if ! doppler me &>/dev/null; then
        print_fail "doppler not logged in (run: doppler login)"
        ((fail_count++))
    else
        print_pass "doppler logged in"
    fi

    # Check required secrets in factorylm/prd
    local required_secrets=("GROQ_API_KEY" "YOUTUBE_CLIENT_ID" "YOUTUBE_CLIENT_SECRET" "YOUTUBE_REFRESH_TOKEN_ISH")
    for secret in "${required_secrets[@]}"; do
        if doppler secrets get "$secret" --project factorylm --config prd --plain &>/dev/null 2>&1; then
            print_pass "Secret found: $secret"
        else
            if [[ "$secret" == "YOUTUBE_REFRESH_TOKEN_ISH" ]]; then
                print_fail "Secret missing: $secret (required for YouTube uploads)"
                print_warn "Promote from dev with:"
                printf "  %s\n" "doppler secrets get YOUTUBE_REFRESH_TOKEN_ISH --project factorylm --config dev --plain | doppler secrets set YOUTUBE_REFRESH_TOKEN_ISH --project factorylm --config prd"
            else
                print_fail "Secret missing: $secret"
            fi
            ((fail_count++))
        fi
    done

    if [[ $fail_count -gt 0 ]]; then
        print_fail "Preflight check failed ($fail_count issues)"
        return 1
    fi

    print_pass "All preflight checks passed"
    return 0
}

# Install function
do_install() {
    printf '\n%sInstalling launchd job...%s\n' "$YELLOW" "$NC"

    # Copy plist
    cp -f "$PLIST_FILE" "$INSTALLED_PLIST"
    print_pass "Plist copied to $INSTALLED_PLIST"

    # Unload if already loaded (idempotent). The list check guards the
    # "not loaded" case so unload's real failures (permission, corrupt
    # plist) propagate instead of being swallowed by `|| true`.
    if launchctl list "$PLIST_NAME" &>/dev/null; then
        launchctl unload -w "$INSTALLED_PLIST"
        print_pass "Unloaded existing instance"
    fi

    # Load with -w (persist across reboots)
    launchctl load -w "$INSTALLED_PLIST"
    print_pass "Loaded with -w (persists across reboot)"

    # Verify install
    if ! launchctl list "$PLIST_NAME" &>/dev/null; then
        print_fail "Failed to load plist (check launchctl error)"
        return 1
    fi
    print_pass "Verified: job is loaded"

    # Calculate and display next run time
    # StartCalendarInterval in plist: Hour=2, Minute=0 (2:00 AM daily)
    local next_run
    if [[ $(date +%H:%M) < "02:00" ]]; then
        next_run="Today at 02:00 AM"
    else
        next_run="Tomorrow at 02:00 AM"
    fi

    printf '\n%sINSTALLED%s\n' "$GREEN" "$NC"
    printf "Next run: %s\n" "$next_run"
    printf "Logs:\n"
    printf "  stdout: /tmp/yt-pipeline-stdout.log\n"
    printf "  stderr: /tmp/yt-pipeline-stderr.log\n"
    printf "\nTail logs with: tail -f /tmp/yt-pipeline-stderr.log\n"
    printf "Pause with: touch /tmp/yt-pipeline/PAUSED\n"
    printf "Resume with: rm /tmp/yt-pipeline/PAUSED\n"
    printf "Uninstall with: %s uninstall\n" "$(basename "$0")"
}

# Uninstall function
do_uninstall() {
    printf '\n%sUninstalling launchd job...%s\n' "$YELLOW" "$NC"

    if ! launchctl list "$PLIST_NAME" &>/dev/null 2>&1; then
        print_warn "Job not loaded (nothing to unload)"
    else
        launchctl unload -w "$INSTALLED_PLIST" 2>/dev/null || true
        print_pass "Unloaded job"
    fi

    if [[ -f "$INSTALLED_PLIST" ]]; then
        rm -f "$INSTALLED_PLIST"
        print_pass "Removed plist from $LAUNCHAGENTS_DIR"
    else
        print_warn "Plist already absent from $LAUNCHAGENTS_DIR"
    fi

    printf '\n%sUNINSTALLED%s\n' "$GREEN" "$NC"
}

# Main
case "$COMMAND" in
    install)
        preflight_check || exit 1
        do_install || exit 1
        ;;
    uninstall)
        do_uninstall || exit 1
        ;;
    *)
        printf "Usage: %s [install|uninstall]\n" "$(basename "$0")"
        exit 1
        ;;
esac
