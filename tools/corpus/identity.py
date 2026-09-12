"""Positive database identity — assert what you ARE, never search for what you aren't.

The predecessor guarded destructive work with:

    if "prod" in url.lower(): raise

Neon connection strings look like
`postgresql://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb`. They
contain neither `prod` nor `staging`, so the check was structurally incapable of
firing on either environment. A DELETE of 3,364 rows ran behind it
(`docs/testing/2026-08-10-corpus-p0-incident.md`).

The lesson is not "use a better substring". A negative check answers "I found no
evidence this is production", which is not the same claim as "this is the
database I meant". So this module only supports the positive form: the caller
DECLARES the expected host and database, the connection REPORTS its own, and the
two must match exactly or nothing runs.

Two independent locks, both required:

  1. `--expect-identity host-prefix/dbname`, compared against what the live
     connection reports via `current_database()` and the parsed host.
  2. `MIRA_CORPUS_MUTATION_OK=1` in the environment — a deliberate act that
     cannot be reached by running a command someone pasted from a doc.

Neither is inferred. A missing or unparseable identity is a refusal, never a
default-allow.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

MUTATION_ENV = "MIRA_CORPUS_MUTATION_OK"


class IdentityError(RuntimeError):
    """Raised instead of mutating anything. Never caught inside this package."""


@dataclass(frozen=True)
class DbIdentity:
    host: str
    database: str

    @property
    def host_prefix(self) -> str:
        """`ep-cool-name-123456` from `ep-cool-name-123456.us-east-2.aws.neon.tech`."""
        return self.host.split(".", 1)[0] if self.host else ""

    def token(self) -> str:
        return f"{self.host_prefix}/{self.database}"

    def redacted(self) -> str:
        """Safe to print: the host prefix identifies the branch, not the secret."""
        return self.token()


def parse_host(url: str) -> str:
    if not url:
        return ""
    try:
        return (urlparse(url).hostname or "").lower()
    except ValueError:
        return ""


def observe(conn, url: str) -> DbIdentity:
    """What this connection actually IS, asked of the connection itself.

    `current_database()` comes from the server rather than the string we dialled,
    so a copy-pasted URL pointing somewhere unexpected cannot masquerade.
    """
    from sqlalchemy import text

    db = conn.execute(text("SELECT current_database()")).scalar() or ""
    return DbIdentity(host=parse_host(url), database=str(db).lower())


_TOKEN_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$")


def assert_target(observed: DbIdentity, expected: str | None) -> None:
    """Refuse unless the caller named this exact database, and armed the env lock."""
    if not expected:
        raise IdentityError(
            "--expect-identity is required for destructive work. Pass "
            f"'{observed.redacted()}' if that is genuinely the database you mean."
        )
    expected = expected.strip().lower()
    if not _TOKEN_RE.match(expected):
        raise IdentityError(
            f"--expect-identity must look like 'host-prefix/dbname', got {expected!r}"
        )
    if expected != observed.token():
        raise IdentityError(
            f"identity mismatch — refusing.\n"
            f"  expected : {expected}\n"
            f"  connected: {observed.redacted()}"
        )
    if os.environ.get(MUTATION_ENV) != "1":
        raise IdentityError(
            f"{MUTATION_ENV}=1 is required for destructive work. Set it deliberately "
            "in this shell; it is intentionally not settable by a flag."
        )
