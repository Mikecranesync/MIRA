"""Cross-tenant regression for engine._post_cmms_work_order (#3237).

The Hub NeonDB write must use the authenticated session tenant
(``resolve_tenant(chat_id)`` / the tenant passed from process_full), never
``MIRA_TENANT_ID`` and never a tenant_id on the work-order payload.

Synthetic tenants only. No live DB, no vendor accounts.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from shared.engine import Supervisor  # noqa: E402
from shared.models.work_order import UNSWorkOrder  # noqa: E402

# Distinct synthetic UUIDs — not real tenants.
TENANT_A = "11111111-1111-4111-8111-111111111111"
TENANT_B = "22222222-2222-4222-8222-222222222222"
CHAT_B = "200"


def _fresh_chat_tenant(db_path: str, env_tenant: str):
    """Reload chat_tenant against an isolated temp DB (reuse test_tenant_isolation)."""
    env_patch = {"MIRA_DB_PATH": db_path, "MIRA_TENANT_ID": env_tenant}
    with patch.dict(os.environ, env_patch, clear=False):
        if "shared.chat_tenant" in sys.modules:
            mod = sys.modules["shared.chat_tenant"]
            importlib.reload(mod)
        else:
            import shared.chat_tenant  # noqa: F401

        mod = sys.modules["shared.chat_tenant"]
        mod._DB_PATH = db_path
        mod._ensure_table()
        mod._db_lookup.cache_clear()
    return mod


def _bare_supervisor():
    sv = Supervisor.__new__(Supervisor)
    sv.mcp_base_url = "http://mira-mcp:8001"
    sv.mcp_api_key = "test-key"
    sv.db_path = ":memory:"
    return sv


def _valid_wo(*, chat_id: str = CHAT_B):
    return UNSWorkOrder(
        asset="Pump-A3",
        title="[MIRA] Pump-A3 — leak action",
        fault_description="Discharge seal leaking on synthetic fixture pump",
        priority="MEDIUM",
        wo_type="CORRECTIVE",
        chat_id=chat_id,
    )


def _valid_draft(*, chat_id: str = CHAT_B, tenant_id: str | None = None) -> dict:
    draft = {
        "asset": "Pump-A3",
        "title": "[MIRA] Pump-A3 — leak action",
        "fault_description": "Discharge seal leaking on synthetic fixture pump",
        "priority": "MEDIUM",
        "wo_type": "CORRECTIVE",
        "chat_id": chat_id,
    }
    if tenant_id is not None:
        draft["tenant_id"] = tenant_id
    return draft


@pytest.fixture
def mapped_tenant_b(tmp_path, monkeypatch):
    """Process env is tenant A; chat 200 is mapped to tenant B via chat_tenant."""
    db_path = str(tmp_path / "mira.db")
    monkeypatch.setenv("MIRA_DB_PATH", db_path)
    monkeypatch.setenv("MIRA_TENANT_ID", TENANT_A)
    ct = _fresh_chat_tenant(db_path, TENANT_A)
    ct.set_mapping(CHAT_B, TENANT_B)
    return ct


def _hub_row_store():
    """In-memory stand-in for Hub work_orders / cmms_equipment rows."""
    rows = {TENANT_A: [], TENANT_B: [{"id": "preexisting-b", "title": "keep-out"}]}
    calls: list[dict] = []

    def create_hub_work_order(**kwargs):
        calls.append(kwargs)
        tid = kwargs["tenant_id"]
        rows.setdefault(tid, []).append(
            {
                "id": f"wo-{len(calls)}",
                "title": kwargs.get("title"),
                "tenant_id": tid,
            }
        )
        return {"id": f"wo-{len(calls)}", "work_order_number": f"MIRA-{len(calls)}"}

    return rows, calls, create_hub_work_order


@pytest.mark.asyncio
async def test_mapped_tenant_push_does_not_write_env_tenant_rows(mapped_tenant_b):
    """Tenant B's confirmed WO must not create or modify tenant A's Hub rows.

    On the old code ``_post_cmms_work_order`` reads ``MIRA_TENANT_ID`` (tenant A)
    and the write lands in A's space. After the fix the caller passes the
    authenticated tenant resolved once at ``process_full``.
    """
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 99})
    tenant_a_before = list(rows[TENANT_A])
    tenant_b_sentinel = list(rows[TENANT_B])

    with (
        patch("shared.engine.resolve_tenant", side_effect=mapped_tenant_b.resolve),
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = {
            "state": "RESOLVED",
            "asset_identified": "Pump-A3",
            "fault_category": "",
            "context": {
                "cmms_pending": True,
                # Drafts are stamped with their creating tenant (F1, #4759).
                "cmms_wo_draft": _valid_draft(tenant_id=TENANT_B),
            },
        }
        result = await sv._handle_cmms_pending(
            CHAT_B, "yes", state, "trace-3237", tenant_id=TENANT_B
        )

    assert "Work order" in result["reply"]
    assert calls, "expected a Hub write for the authenticated tenant"
    assert all(c["tenant_id"] == TENANT_B for c in calls)
    assert all(c["tenant_id"] != TENANT_A for c in calls)
    assert rows[TENANT_A] == tenant_a_before
    assert rows[TENANT_B][0] == tenant_b_sentinel[0]
    assert any(r.get("title") == "[MIRA] Pump-A3 — leak action" for r in rows[TENANT_B])


@pytest.mark.asyncio
async def test_post_cmms_work_order_uses_caller_tenant_not_env(mapped_tenant_b):
    """Direct write path: caller tenant B must win over env tenant A."""
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 42})
    tenant_a_before = list(rows[TENANT_A])

    with (
        patch("shared.engine.resolve_tenant", side_effect=mapped_tenant_b.resolve),
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
    ):
        sv = _bare_supervisor()
        # Sole production caller (_handle_cmms_pending) always passes the
        # authenticated tenant; this direct call does the same. _post no
        # longer consults resolve_tenant / MIRA_TENANT_ID.
        await sv._post_cmms_work_order(_valid_wo(), tenant_id=TENANT_B)

    assert calls and calls[0]["tenant_id"] == TENANT_B
    assert rows[TENANT_A] == tenant_a_before
    assert not any(r.get("tenant_id") == TENANT_A for r in calls)


@pytest.mark.asyncio
async def test_payload_tenant_mismatch_rejects_and_leaves_other_tenant_rows(mapped_tenant_b):
    """A forged payload tenant_id for B must not create or modify B's rows when auth is A."""
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 7})
    tenant_b_before = list(rows[TENANT_B])

    wo = _valid_wo(chat_id="unmapped-chat")
    wo.tenant_id = TENANT_B  # payload claim — never authoritative

    with (
        patch("shared.engine.resolve_tenant", return_value=TENANT_A),
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
    ):
        sv = _bare_supervisor()
        with pytest.raises(RuntimeError, match="tenant_mismatch"):
            await sv._post_cmms_work_order(wo, tenant_id=TENANT_A)

    assert calls == []
    atlas.create_work_order.assert_not_awaited()
    assert rows[TENANT_B] == tenant_b_before


@pytest.mark.asyncio
async def test_handle_pending_rejects_draft_tenant_mismatch(mapped_tenant_b):
    """cmms_wo_draft.tenant_id for B is rejected when the session tenant is A."""
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 7})
    tenant_b_before = list(rows[TENANT_B])

    with (
        patch("shared.engine.resolve_tenant", return_value=TENANT_A),
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = {
            "state": "RESOLVED",
            "asset_identified": "Pump-A3",
            "fault_category": "",
            "context": {
                "cmms_pending": True,
                "cmms_wo_draft": _valid_draft(chat_id="unmapped-chat", tenant_id=TENANT_B),
            },
        }
        result = await sv._handle_cmms_pending(
            "unmapped-chat", "yes", state, "trace-3237", tenant_id=TENANT_A
        )

    assert "manually" not in result["reply"].lower()
    assert calls == []
    atlas.create_work_order.assert_not_awaited()
    assert rows[TENANT_B] == tenant_b_before
    assert state["context"].get("cmms_pending") is True
    assert state["context"].get("cmms_wo_draft") == _valid_draft(
        chat_id="unmapped-chat", tenant_id=TENANT_B
    )


@pytest.mark.asyncio
async def test_mismatch_leaves_pending_confirmation_intact(mapped_tenant_b):
    """A rejected cross-tenant yes must not consume the WO confirmation (#4759 Gate-7)."""
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 7})
    draft = _valid_draft(chat_id="unmapped-chat", tenant_id=TENANT_B)

    with (
        patch("shared.engine.resolve_tenant", return_value=TENANT_A),
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = {
            "state": "RESOLVED",
            "asset_identified": "Pump-A3",
            "fault_category": "",
            "context": {
                "cmms_pending": True,
                "cmms_wo_draft": draft,
            },
        }
        result = await sv._handle_cmms_pending(
            "unmapped-chat", "yes", state, "trace-3237", tenant_id=TENANT_A
        )

    assert result["dispatch_kind"] == "cmms_pending"
    assert state["context"]["cmms_pending"] is True
    assert state["context"]["cmms_wo_draft"] is draft
    sv._save_state.assert_not_called()
    assert calls == []
    atlas.create_work_order.assert_not_awaited()


@pytest.mark.asyncio
async def test_same_tenant_id_variants_accepted_different_tenant_rejected(mapped_tenant_b):
    """Case / hyphen variants of the same UUID are the same tenant; TENANT_B is not."""
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 3})
    tenant_b_before = list(rows[TENANT_B])
    variants = (
        TENANT_A.upper(),
        TENANT_A.replace("-", ""),
        TENANT_A.replace("-", "").upper(),
    )

    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        for variant in variants:
            wo = _valid_wo(chat_id="unmapped-chat")
            wo.tenant_id = variant
            await sv._post_cmms_work_order(wo, tenant_id=TENANT_A)

        wo_b = _valid_wo(chat_id="unmapped-chat")
        wo_b.tenant_id = TENANT_B
        with pytest.raises(RuntimeError, match="tenant_mismatch"):
            await sv._post_cmms_work_order(wo_b, tenant_id=TENANT_A)

        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        draft = _valid_draft(chat_id="unmapped-chat", tenant_id=TENANT_A.upper())
        state = {
            "state": "RESOLVED",
            "asset_identified": "Pump-A3",
            "fault_category": "",
            "context": {"cmms_pending": True, "cmms_wo_draft": draft},
        }
        result = await sv._handle_cmms_pending(
            "unmapped-chat", "yes", state, "trace-3237", tenant_id=TENANT_A
        )

    assert "Work order" in result["reply"]
    assert len(calls) == len(variants) + 1
    assert all(c["tenant_id"] == TENANT_A for c in calls)
    assert rows[TENANT_B] == tenant_b_before


@pytest.mark.asyncio
async def test_non_uuid_tenant_ids_case_difference_rejected():
    """Non-UUID slugs that differ only by case are different tenants."""
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 4})

    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        wo_match = _valid_wo(chat_id="unmapped-chat")
        wo_match.tenant_id = "PlantAlpha"
        await sv._post_cmms_work_order(wo_match, tenant_id="PlantAlpha")

        wo_case = _valid_wo(chat_id="unmapped-chat")
        wo_case.tenant_id = "PlantAlpha"
        with pytest.raises(RuntimeError, match="tenant_mismatch"):
            await sv._post_cmms_work_order(wo_case, tenant_id="plantalpha")

        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        draft = _valid_draft(chat_id="unmapped-chat", tenant_id="PlantAlpha")
        state = {
            "state": "RESOLVED",
            "asset_identified": "Pump-A3",
            "fault_category": "",
            "context": {"cmms_pending": True, "cmms_wo_draft": draft},
        }
        result = await sv._handle_cmms_pending(
            "unmapped-chat", "yes", state, "trace-3237", tenant_id="plantalpha"
        )

    assert "session tenant doesn't match" in result["reply"]
    assert state["context"]["cmms_pending"] is True
    assert state["context"]["cmms_wo_draft"] is draft
    sv._save_state.assert_not_called()
    assert len(calls) == 1
    assert calls[0]["tenant_id"] == "PlantAlpha"
    atlas.create_work_order.assert_awaited_once()


@pytest.mark.parametrize(
    "payload_tenant, auth_tenant",
    [
        ("PlantAlpha", "PlantAlpha "),
        ("PlantAlpha", "plantalpha"),
        ("PlantAlpha", "Pl\u0430ntAlpha"),
    ],
    ids=["trailing-space", "case", "cyrillic-a-lookalike"],
)
@pytest.mark.asyncio
async def test_non_uuid_near_miss_pairs_rejected(payload_tenant, auth_tenant):
    """Whitespace, case, and unicode lookalikes are different tenants."""
    _rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 5})

    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        wo = _valid_wo(chat_id="unmapped-chat")
        wo.tenant_id = payload_tenant
        with pytest.raises(RuntimeError, match="tenant_mismatch"):
            await sv._post_cmms_work_order(wo, tenant_id=auth_tenant)

        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        draft = _valid_draft(chat_id="unmapped-chat", tenant_id=payload_tenant)
        state = {
            "state": "RESOLVED",
            "asset_identified": "Pump-A3",
            "fault_category": "",
            "context": {"cmms_pending": True, "cmms_wo_draft": draft},
        }
        result = await sv._handle_cmms_pending(
            "unmapped-chat", "yes", state, "trace-3237", tenant_id=auth_tenant
        )

    assert "session tenant doesn't match" in result["reply"]
    assert state["context"]["cmms_pending"] is True
    assert state["context"]["cmms_wo_draft"] is draft
    sv._save_state.assert_not_called()
    assert calls == []
    atlas.create_work_order.assert_not_awaited()


@pytest.mark.asyncio
async def test_empty_tenant_id_raises_and_writes_nothing():
    """Empty tenant_id must raise before Atlas or Hub is touched."""
    _rows, calls, fake_create = _hub_row_store()
    atlas_cls = MagicMock()
    atlas_cls.return_value.create_work_order = AsyncMock(return_value={"id": 6})

    with (
        patch("shared.engine.AtlasCMMSClient", atlas_cls),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        with pytest.raises(RuntimeError, match="tenant_required"):
            await sv._post_cmms_work_order(_valid_wo(), tenant_id="")

    atlas_cls.assert_not_called()
    atlas_cls.return_value.create_work_order.assert_not_awaited()
    assert calls == []


@pytest.mark.asyncio
async def test_handle_empty_tenant_refuses_and_leaves_pending_intact(mapped_tenant_b):
    """Empty tenant_id must refuse before any pending mutation or write."""
    rows, calls, fake_create = _hub_row_store()
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 8})
    draft = _valid_draft(chat_id="unmapped-chat")
    resolve = MagicMock(return_value=TENANT_A)

    with (
        patch("shared.engine.resolve_tenant", resolve),
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = {
            "state": "RESOLVED",
            "asset_identified": "Pump-A3",
            "fault_category": "",
            "context": {"cmms_pending": True, "cmms_wo_draft": draft},
        }
        result = await sv._handle_cmms_pending(
            "unmapped-chat", "yes", state, "trace-3237", tenant_id=""
        )

    assert "session has no tenant" in result["reply"]
    assert result["dispatch_kind"] == "cmms_pending"
    assert state["context"]["cmms_pending"] is True
    assert state["context"]["cmms_wo_draft"] is draft
    sv._save_state.assert_not_called()
    sv._record_exchange.assert_not_called()
    resolve.assert_not_called()
    atlas.create_work_order.assert_not_awaited()
    assert calls == []
    assert rows[TENANT_A] == []


# ---------------------------------------------------------------------------
# Codex round-1 findings on #4759 (F1 unstamped drafts, F2 env-only tenant,
# F3 decline without a tenant). Each test isolates one condition.
# ---------------------------------------------------------------------------


def _pending_state(draft: dict) -> dict:
    return {
        "state": "RESOLVED",
        "context": {"cmms_pending": True, "cmms_wo_draft": dict(draft)},
    }


def _write_spies():
    atlas = MagicMock()
    atlas.create_work_order = AsyncMock(return_value={"id": 99})
    rows, calls, fake_create = _hub_row_store()
    return atlas, calls, fake_create


@pytest.mark.asyncio
async def test_unstamped_draft_is_refused_and_stays_pending(mapped_tenant_b):
    """F1: a draft with no creating tenant is never adopted by the confirmer."""
    atlas, calls, fake_create = _write_spies()
    draft = _valid_draft(chat_id=CHAT_B)  # no tenant_id stamp
    assert "tenant_id" not in draft
    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = _pending_state(draft)
        result = await sv._handle_cmms_pending(CHAT_B, "yes", state, "trace-f1", tenant_id=TENANT_B)
    assert calls == []
    atlas.create_work_order.assert_not_called()
    assert state["context"]["cmms_pending"] is True
    assert state["context"]["cmms_wo_draft"] == draft
    assert "doesn't match" in result["reply"]


@pytest.mark.asyncio
async def test_stamped_draft_same_tenant_still_writes(mapped_tenant_b):
    """F1 control: the creating tenant can still confirm its own draft."""
    atlas, calls, fake_create = _write_spies()
    draft = _valid_draft(chat_id=CHAT_B, tenant_id=TENANT_B)
    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        await sv._handle_cmms_pending(
            CHAT_B, "yes", _pending_state(draft), "trace-f1c", tenant_id=TENANT_B
        )
    assert [c["tenant_id"] for c in calls] == [TENANT_B]


@pytest.mark.asyncio
async def test_env_only_tenant_resolves_to_no_write_tenant(tmp_path, monkeypatch):
    """F2: with MIRA_TENANT_ID set and no chat mapping, the write tenant is empty
    and a confirmation through it writes nothing."""
    db_path = str(tmp_path / "mira.db")
    monkeypatch.setenv("MIRA_DB_PATH", db_path)
    monkeypatch.setenv("MIRA_TENANT_ID", TENANT_A)
    ct = _fresh_chat_tenant(db_path, TENANT_A)
    unmapped = "unmapped-f2"
    assert ct.resolve(unmapped) == TENANT_A  # compatibility read still sees env
    assert ct.resolve_mapped_only(unmapped) == ""  # the write path does not
    ct.set_mapping(CHAT_B, TENANT_B)
    assert ct.resolve_mapped_only(CHAT_B) == TENANT_B

    atlas, calls, fake_create = _write_spies()
    draft = _valid_draft(chat_id=unmapped, tenant_id=TENANT_A)
    with (
        patch("shared.engine.resolve_mapped_only", side_effect=ct.resolve_mapped_only),
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
    ):
        import shared.engine as engine_mod

        write_tenant = engine_mod.resolve_mapped_only(unmapped)
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = _pending_state(draft)
        await sv._handle_cmms_pending(unmapped, "yes", state, "trace-f2", tenant_id=write_tenant)
    assert write_tenant == ""
    assert calls == []
    atlas.create_work_order.assert_not_called()
    assert state["context"]["cmms_pending"] is True


@pytest.mark.asyncio
async def test_decline_cancels_without_tenant():
    """F3: "no" clears the pending draft even when the session has no tenant."""
    atlas, calls, fake_create = _write_spies()
    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = _pending_state(_valid_draft(tenant_id=TENANT_B))
        await sv._handle_cmms_pending(CHAT_B, "no", state, "trace-f3", tenant_id="")
    assert "cmms_pending" not in state["context"]
    assert "cmms_wo_draft" not in state["context"]
    sv._save_state.assert_called_once()
    assert calls == []
    atlas.create_work_order.assert_not_called()


@pytest.mark.asyncio
async def test_yes_without_tenant_still_refuses_and_keeps_draft():
    """F3 control: only a decline proceeds without a tenant; a yes still refuses."""
    atlas, calls, fake_create = _write_spies()
    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = _pending_state(_valid_draft(tenant_id=TENANT_B))
        result = await sv._handle_cmms_pending(CHAT_B, "yes", state, "trace-f3c", tenant_id="")
    assert state["context"]["cmms_pending"] is True
    sv._save_state.assert_not_called()
    assert calls == []
    assert "no tenant" in result["reply"]


# ---------------------------------------------------------------------------
# Codex round-2 F4 on #4759: a different authenticated tenant may not read,
# edit or cancel another tenant's pending draft.
# ---------------------------------------------------------------------------


async def _pending_turn(message: str, draft: dict, tenant_id: str):
    atlas, calls, fake_create = _write_spies()
    with (
        patch("shared.engine.AtlasCMMSClient", return_value=atlas),
        patch("shared.engine.create_hub_work_order", side_effect=fake_create),
        patch("shared.engine.log_uns_event"),
        patch("shared.engine.push_wo_created", new_callable=AsyncMock),
        patch("shared.engine.suggest_followup_pm", return_value=None),
    ):
        sv = _bare_supervisor()
        sv._record_exchange = MagicMock()
        sv._save_state = MagicMock()
        state = _pending_state(draft)
        result = await sv._handle_cmms_pending(
            CHAT_B, message, state, "trace-f4", tenant_id=tenant_id
        )
    return result, state, sv, calls


@pytest.mark.asyncio
@pytest.mark.parametrize("message", ["hmm", "asset is Pump B", "no"])
async def test_foreign_tenant_cannot_read_edit_or_cancel_draft(message):
    """F4: tenant B gets no preview, no edit and no cancel of tenant A's draft."""
    draft = _valid_draft(tenant_id=TENANT_A)
    result, state, sv, calls = await _pending_turn(message, draft, TENANT_B)
    assert state["context"]["cmms_pending"] is True
    assert state["context"]["cmms_wo_draft"] == draft  # untouched
    sv._save_state.assert_not_called()
    assert calls == []
    assert draft["fault_description"] not in result["reply"]  # no preview leak
    assert "doesn't match" in result["reply"]


@pytest.mark.asyncio
async def test_owner_tenant_can_still_edit_its_draft():
    """F4 control: the creating tenant's edit is applied and persisted."""
    draft = _valid_draft(tenant_id=TENANT_B)
    result, state, sv, calls = await _pending_turn("asset is Pump B", draft, TENANT_B)
    assert state["context"]["cmms_wo_draft"]["asset"] != draft["asset"]
    assert state["context"]["cmms_wo_draft"]["tenant_id"] == TENANT_B
    sv._save_state.assert_called()
    assert calls == []


@pytest.mark.asyncio
async def test_unstamped_draft_may_be_declined_but_not_previewed():
    """F4: a legacy unstamped draft can be cancelled, never shown or edited."""
    draft = _valid_draft()
    assert "tenant_id" not in draft
    result, state, sv, _ = await _pending_turn("hmm", draft, TENANT_B)
    assert state["context"]["cmms_wo_draft"] == draft
    assert draft["fault_description"] not in result["reply"]
    result, state, sv, _ = await _pending_turn("no", draft, TENANT_B)
    assert "cmms_wo_draft" not in state["context"]
