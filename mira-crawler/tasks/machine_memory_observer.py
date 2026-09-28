"""Celery task — the §9.4 CV-101 Machine Memory observer (READ-ONLY).

Scheduled on the synthetic-dogfood beat profile (celeryconfig) once a day.
NO-OP unless MACHINE_MEMORY_OBSERVER_ENABLED=1. Only GETs the Hub's public
tenant-scoped APIs with the observer's own session; writes only its own
report files under DOGFOOD_REPORT_DIR/machine-memory-observer/.

Env:
  MACHINE_MEMORY_OBSERVER_ENABLED   "1" to enable (default off)
  MACHINE_MEMORY_OBSERVER_ASSET_ID  the CV-101 asset (kg_entities) id
  MACHINE_MEMORY_OBSERVER_EMAIL / _PASSWORD   an existing login in the tenant
                                    that owns CV-101 (signs in; never registers)
  MACHINE_MEMORY_OBSERVER_COOKIE    alternative: a pre-minted next-auth cookie
  DOGFOOD_TARGET_URL                Hub base (shared with the dogfood runner)
  DOGFOOD_REPORT_DIR                report root (shared with the dogfood runner)
"""

from __future__ import annotations

import os
import re
from typing import Any, Callable

try:
    from mira_crawler.celery_app import app
except (ImportError, ModuleNotFoundError):
    try:
        from celery_app import app
    except (ImportError, ModuleNotFoundError):

        class _OfflineTaskApp:
            def task(
                self, *_a: Any, **_k: Any
            ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
                return lambda fn: fn

        app = _OfflineTaskApp()

from agents.machine_memory_observer import ObserverConfig, observe_once


class HttpxHub:
    """Minimal read-only Hub client: sign in once (if given a login), then GET."""

    def __init__(self, base: str, cookie: str | None, email: str | None, password: str | None):
        import httpx

        self._client = httpx.Client(base_url=base, timeout=60, follow_redirects=False)
        self._cookie = cookie
        if not self._cookie and email and password:
            self._cookie = self._sign_in(email, password)

    def _sign_in(self, email: str, password: str) -> str:
        csrf = self._client.get("/api/auth/csrf/")
        csrf.raise_for_status()
        r = self._client.post(
            "/api/auth/callback/credentials/",
            data={
                "email": email,
                "password": password,
                "csrfToken": csrf.json()["csrfToken"],
                "redirect": "false",
                "json": "true",
            },
            follow_redirects=False,
        )
        m = re.findall(
            r"next-auth\.session-token=([^;,\s]+)", ", ".join(r.headers.get_list("set-cookie"))
        )
        if not m:
            raise RuntimeError(f"observer sign-in produced no session (HTTP {r.status_code})")
        return f"next-auth.session-token={m[-1]}"

    def get(self, path: str) -> tuple[int, dict[str, Any]]:
        r = self._client.get(path, headers={"Cookie": self._cookie} if self._cookie else {})
        try:
            body = r.json()
        except ValueError:
            body = {}
        return r.status_code, body if isinstance(body, dict) else {}


@app.task(name="tasks.machine_memory_observer.observe_cv101_machine_memory")
def observe_cv101_machine_memory() -> dict[str, Any]:
    """One daily read-only observation of CV-101 Machine Memory."""
    config = ObserverConfig.from_env()
    if not config.enabled:
        return observe_once(config, hub=None)  # type: ignore[arg-type]  # inert: no client is built
    hub = HttpxHub(
        config.hub_base,
        config.cookie,
        os.getenv("MACHINE_MEMORY_OBSERVER_EMAIL"),
        os.getenv("MACHINE_MEMORY_OBSERVER_PASSWORD"),
    )
    return observe_once(config, hub)
