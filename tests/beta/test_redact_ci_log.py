"""tools/qa/redact_ci_log.sh must strip every credential shape a Hub log can echo."""

from __future__ import annotations

import pathlib
import shutil
import subprocess

import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "tools" / "qa" / "redact_ci_log.sh"


def _bash() -> str | None:
    # On Windows, System32\bash.exe is the WSL launcher (no POSIX paths); prefer Git Bash.
    for cand in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files\Git\usr\bin\bash.exe"):
        if pathlib.Path(cand).exists():
            return cand
    return shutil.which("bash")


BASH = _bash()

SAMPLE = "\n".join(
    [
        "cookie: next-auth.session-token=eyJSECRETJWE.abc; Path=/",
        "Authorization: Bearer sk-live-HUNTER1",
        'error: {"password":"hunter2","apiKey": "HUNTER3", "token"= HUNTER4}',
        "connect ECONNREFUSED postgres://neondb_owner:HUNTER5@ep-x.neon.tech/neondb?sslmode=require",
        "doppler: dp.st.stg.HUNTER6token dp.ct.HUNTER7",
        "kept: tenant=9ae14764-fdab-4167-ba79-2659c5fcc200 answer='It is 137 newton meters [1].'",
    ]
)


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_redacts_every_credential_shape_and_keeps_evidence():
    out = subprocess.run(
        [BASH, str(SCRIPT)], input=SAMPLE, capture_output=True, text=True, check=True
    ).stdout
    for secret in (
        "SECRETJWE",
        "HUNTER1",
        "hunter2",
        "HUNTER3",
        "HUNTER4",
        "HUNTER5",
        "HUNTER6",
        "HUNTER7",
    ):
        assert secret not in out, f"{secret} leaked:\n{out}"
    assert out.count("[redacted]") >= 8
    # non-secret evidence survives
    assert "9ae14764-fdab-4167-ba79-2659c5fcc200" in out and "137 newton meters" in out
    assert "postgres://neondb_owner:[redacted]@ep-x.neon.tech" in out
