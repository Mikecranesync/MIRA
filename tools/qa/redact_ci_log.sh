#!/usr/bin/env bash
# Redact credentials from a CI log before it is echoed or uploaded as an artifact.
# stdin → stdout. Used by .github/workflows/beta-gate.yml; pinned by
# tests/beta/test_redact_ci_log.py.
#
# Covers: next-auth session cookies, JWTs, Bearer/Basic/Authorization values
# (any case), generic password/secret/apiKey/token assignments (quoted values
# whole, including spaces), connection-string userinfo
# (postgres://user:PASS@host), and Doppler token shapes (dp.st.* / dp.pt.* /
# dp.ct.*). GitHub only masks REGISTERED secrets, not values a process derives
# or echoes, so this runs on every uploaded log regardless of ::add-mask::.
set -euo pipefail
sed -E \
  -e 's/next-auth\.session-token=[^ ;"]+/next-auth.session-token=[redacted]/g' \
  -e 's/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/[redacted]/g' \
  -e 's/((authorization:[[:space:]]*((bearer|basic)[[:space:]]+)?|(bearer|basic)[[:space:]]+))[^ "]+/\1[redacted]/gI' \
  -e 's/((password|passwd|secret|apiKey|api_key|token)"?[[:space:]]*[:=][[:space:]]*")[^"]*"/\1[redacted]"/gI' \
  -e "s/((password|passwd|secret|apiKey|api_key|token)'?[[:space:]]*[:=][[:space:]]*')[^']*'/\\1[redacted]'/gI" \
  -e 's/((password|passwd|secret|apiKey|api_key|token)"?[[:space:]]*[:=][[:space:]]*"?)[^",} ]+/\1[redacted]/gI' \
  -e 's#([a-zA-Z][a-zA-Z0-9+.-]*://[^:/@ ]+:)[^@ ]+@#\1[redacted]@#g' \
  -e 's/dp\.(st|pt|ct|sa|scim|audit)\.[A-Za-z0-9_.-]+/[redacted]/g'
