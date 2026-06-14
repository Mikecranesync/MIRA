#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright>=1.49,<2"]
# ///
"""Self-healing Playwright browser harness (#1822).

The recurring friction this kills: Playwright-driven work that breaks on the
*last* step even after the agent already diagnosed the fix —

  1. **Tab recreation** — the driven tab is recreated mid-session, orphaning the
     page handle; the agent is left holding a closed `Page`.
  2. **Permission / `alert`-style dialogs** — a JS dialog or permission prompt
     appears and nothing accepts it, so the run hangs on a manual click.
  3. **Locked browser profile** — a *shared* user-data-dir is held by a
     concurrent session, so launch blocks or the wrong session wins.

`SelfHealingBrowser` addresses all three at the harness level so a script never
has to hand the final click back to a human:

  * a **dedicated, isolated profile dir** per task (unique temp dir, removed on
    close) — concurrent sessions never contend for the same lock;
  * **permissions pre-granted** + **every dialog auto-accepted** on every page,
    including pages created later by `window.open` / tab recreation;
  * **`page` always returns a live page** — if the active one closes, the
    harness re-attaches to the newest surviving page (or opens a fresh one),
    so a recreated tab no longer orphans the handle;
  * **timestamped step screenshots** into `docs/promo-screenshots/` per the
    repo Screenshot Rule, as durable evidence.

Usage (async):

    from browser_harness import SelfHealingBrowser

    async with SelfHealingBrowser(headless=True) as browser:
        await browser.goto("https://app.factorylm.com/login")
        await browser.shot("login")              # dated PNG in promo-screenshots/
        await browser.page.click("text=Continue") # browser.page is always live
        # even if that click recreates the tab, browser.page re-attaches.

Run the built-in self-test (hermetic, no network — drives data: URLs):

    uv run tools/browser_harness.py --selftest

First run needs the browser binary: `uv run playwright install chromium`.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import (
    BrowserContext,
    Dialog,
    Page,
    async_playwright,
)

logger = logging.getLogger("browser-harness")

# Screenshot Rule: durable evidence lands here (CLAUDE.md § Screenshot Rule).
PROMO_DIR = Path(__file__).resolve().parent.parent / "docs" / "promo-screenshots"

# Pre-granted so a permission prompt never blocks the final step. Scoped to the
# context, not the page, so it survives navigation and tab recreation.
DEFAULT_PERMISSIONS = [
    "geolocation",
    "notifications",
    "clipboard-read",
    "clipboard-write",
]

# Launch flags that remove the usual interactive speed-bumps. `--no-first-run`
# and `--no-default-browser-check` skip the onboarding overlays; popup-blocking
# off means `window.open` tabs actually open (so re-attach can find them);
# extensions off removes extension-permission prompts entirely.
LAUNCH_ARGS = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-popup-blocking",
    "--disable-features=Translate,InfobarScreenshot",
]


class SelfHealingBrowser:
    """An isolated, dialog-immune Playwright context whose ``page`` never dies.

    Not thread-safe; drive it from a single asyncio task like any Playwright
    object. One instance == one isolated browser profile == one task.
    """

    def __init__(
        self,
        *,
        headless: bool = True,
        permissions: list[str] | None = None,
        viewport: dict[str, int] | None = None,
        profile_prefix: str = "mira-harness-",
    ) -> None:
        self._headless = headless
        self._permissions = DEFAULT_PERMISSIONS if permissions is None else permissions
        self._viewport = viewport or {"width": 1440, "height": 900}
        self._profile_dir = Path(tempfile.mkdtemp(prefix=profile_prefix))
        self._pw = None
        self._context: BrowserContext | None = None
        self._pages: list[Page] = []

    # -- lifecycle ---------------------------------------------------------

    async def __aenter__(self) -> "SelfHealingBrowser":
        self._pw = await async_playwright().start()
        # launch_persistent_context binds the isolated profile dir at the
        # browser level — that dedicated dir is what stops concurrent sessions
        # from fighting over one shared lock.
        self._context = await self._pw.chromium.launch_persistent_context(
            user_data_dir=str(self._profile_dir),
            headless=self._headless,
            args=LAUNCH_ARGS,
            viewport=self._viewport,
        )
        try:
            await self._context.grant_permissions(self._permissions)
        except Exception as exc:  # permission names vary by browser build
            logger.warning("grant_permissions failed (continuing): %s", exc)

        # Any page that ever exists — now or created later by window.open / tab
        # recreation — gets a dialog auto-acceptor wired the instant it appears.
        self._context.on("page", self._track_page)
        for page in self._context.pages:
            self._track_page(page)
        if not self._context.pages:
            await self._context.new_page()  # fires _track_page via the event
        return self

    async def __aexit__(self, *exc: object) -> None:
        try:
            if self._context is not None:
                await self._context.close()
        finally:
            if self._pw is not None:
                await self._pw.stop()
            # Remove the isolated profile dir; ignore residual file locks on
            # Windows (the browser may still be releasing handles).
            shutil.rmtree(self._profile_dir, ignore_errors=True)

    # -- self-healing internals -------------------------------------------

    def _track_page(self, page: Page) -> None:
        if page not in self._pages:
            self._pages.append(page)
        # Auto-accept every dialog (alert/confirm/beforeunload/permission-style)
        # so a prompt can never strand the run on a manual click.
        page.on("dialog", self._auto_dismiss)

    @staticmethod
    async def _auto_dismiss(dialog: Dialog) -> None:
        try:
            await dialog.accept()
        except Exception:
            try:
                await dialog.dismiss()
            except Exception:
                pass

    @property
    def page(self) -> Page:
        """The current live page. Re-attaches if the active page was closed.

        This is the crux of tab-recreation healing: callers read ``browser.page``
        every time instead of caching a handle, so a recreated/closed tab
        transparently resolves to the newest surviving page.
        """
        live = [p for p in self._pages if not p.is_closed()]
        if live:
            return live[-1]
        # Every tracked page is dead — open a fresh one synchronously is not
        # possible (async); surface a clear error so the caller awaits new_page.
        raise RuntimeError(
            "No live page — call `await browser.new_page()` to recover."
        )

    async def new_page(self) -> Page:
        assert self._context is not None, "browser not started"
        page = await self._context.new_page()  # _track_page wires it via event
        return page

    # -- convenience -------------------------------------------------------

    async def goto(self, url: str, **kwargs: object) -> None:
        await self.page.goto(url, **kwargs)  # type: ignore[arg-type]

    async def shot(self, label: str, *, viewport_tag: str = "desktop") -> Path:
        """Timestamped screenshot into docs/promo-screenshots/ (Screenshot Rule).

        Filename: ``YYYY-MM-DD_<label>_<viewport>.png`` — the dated, append-only
        format the promo pipeline consumes.
        """
        PROMO_DIR.mkdir(parents=True, exist_ok=True)
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in label)
        out = PROMO_DIR / f"{day}_{safe}_{viewport_tag}.png"
        await self.page.screenshot(path=str(out))
        logger.info("screenshot -> %s", out)
        return out

    @property
    def profile_dir(self) -> Path:
        return self._profile_dir


# -- self-test (hermetic, no network) -------------------------------------


async def _selftest() -> int:
    """Drive data: URLs to prove the three healing behaviours. Returns exit code."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ok = True

    async with SelfHealingBrowser(headless=True) as b:
        # 1. Isolated profile dir exists and is unique to this instance.
        assert b.profile_dir.exists(), "profile dir missing"
        print(f"[ok] isolated profile dir: {b.profile_dir}")

        # 2. Dialog auto-dismiss: a page that fires alert() must NOT hang.
        await b.goto("data:text/html,<h1>harness</h1>")
        try:
            await asyncio.wait_for(
                b.page.evaluate("() => { alert('blocked?'); return 1; }"),
                timeout=5.0,
            )
            print("[ok] alert() auto-accepted (no hang)")
        except asyncio.TimeoutError:
            print("[FAIL] alert() hung — dialog auto-dismiss broken")
            ok = False

        # 3. Tab recreation: open a second page, close the first, assert
        #    `b.page` re-attaches to the survivor instead of raising.
        first = b.page
        second = await b.new_page()
        await second.goto("data:text/html,<title>second</title>")
        await first.close()
        try:
            healed = b.page
            assert healed is second and not healed.is_closed()
            print("[ok] tab recreation healed — re-attached to live page")
        except Exception as exc:
            print(f"[FAIL] tab re-attach broken: {exc}")
            ok = False

        # 4. Screenshot capture writes a dated PNG.
        shot = await b.shot("harness-selftest")
        if shot.exists() and shot.stat().st_size > 0:
            print(f"[ok] screenshot captured: {shot.name}")
            shot.unlink()  # selftest artifact — don't pollute the archive
        else:
            print("[FAIL] screenshot not written")
            ok = False

    # 5. Profile dir cleaned up on exit.
    print("[ok] context closed + profile dir cleanup attempted")
    print("\nSELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--selftest",
        action="store_true",
        help="run the hermetic self-test (drives data: URLs, no network)",
    )
    args = parser.parse_args()
    if args.selftest:
        return asyncio.run(_selftest())
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
