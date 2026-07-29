"""Staging E2E proof for photo memory — deployed code + real staging Neon.

Runs INSIDE the staging bot container (never prod):

    ssh prod "docker cp tools/qa/staging_photo_memory_e2e.py stg-mira-bot-telegram:/tmp/ \
        && docker exec stg-mira-bot-telegram python /tmp/staging_photo_memory_e2e.py"

(or `docker exec` directly if the file already ships in the image under
/app/tools/qa/). Generalizes the uncommitted `e2e_proof.py` that caught the
#2798 tenant-cast bug when tests+CI didn't — now versioned so any session can
re-run it.

Two sections, each proving persistence + the deployed follow-up rung against
the REAL store (staging Neon or the InMemory degrade path):

  1. PRINT workspace  (#2798): synthetic K17 print → close-up supersede →
     `bot._try_print_workspace_followup` turns.
  2. EQUIPMENT photo memory (this branch): equipment photo + precomputed
     nameplate fields → `bot._try_equipment_photo_followup` turns (model
     number / manufacturer / generic recall / safety fall-through). Skipped
     with a clear message when the deployed image predates the rung.

Zero tokens by design: persistence replays precomputed vision/nameplate
results (model-free adapters) and the equipment rung is deterministic.
Synthetic chat ids keep real chats untouched. Exit 0 = all proofs passed.
"""

from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, "/app")

from unittest.mock import AsyncMock, MagicMock  # noqa: E402

import shared.print_workspace as pw  # noqa: E402

PRINT_CHAT = "e2e-proof-2798"
EQUIP_CHAT = "e2e-photo-memory"
TENANT = "staging"

_EQUIP_FIELDS = {
    "manufacturer": "TECO",
    "model": "AEHH8N",
    "serial": "SN-4471",
    "voltage": "460V",
    "fla": "6.2",
    "hp": "5",
    "raw_text": "TECO AEHH8N 5HP 460V 6.2A SN-4471",
}

_EQUIP_VISION = {
    "classification": "EQUIPMENT_PHOTO",
    "classification_confidence": 0.9,
    "vision_result": "a TECO 3-phase induction motor, 5 HP, mounted on a base",
    "ocr_items": ["TECO", "AEHH8N", "5HP", "460V"],
    "ocr_tokens": [],
}


def _png() -> bytes:
    """A crisp synthetic image that passes the quality gate (no PIL needed
    beyond what the bot image already ships)."""
    import io

    from PIL import Image

    img = Image.new("L", (320, 240))
    px = img.load()
    for y in range(240):
        for x in range(320):
            px[x, y] = 255 if ((x // 8) + (y // 8)) % 2 == 0 else 0
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _fake_update(chat_id: str):
    u = MagicMock()
    u.effective_chat.id = chat_id
    u.effective_user.id = chat_id
    u.message.reply_text = AsyncMock()
    return u


async def _rung_turn(bot, rung_name: str, chat_id: str, text: str) -> tuple[bool, str]:
    u = _fake_update(chat_id)
    claimed = await getattr(bot, rung_name)(text, u, MagicMock())
    reply = "\n".join(str(c.args[0]) for c in u.message.reply_text.await_args_list)
    return claimed, reply


async def _print_section(bot) -> bool:
    print("=" * 60)
    print("SECTION 1 — print workspace (#2798)")
    print("=" * 60)
    try:
        from printsense.benchmarks.persistent_qa_fixture import (
            BASE,
            CLOSE_UP_BASE,
            page_png,
            vision_data,
        )
    except ImportError as exc:
        print(f"SKIP: persistent_qa_fixture unavailable ({exc})")
        return True

    outcome = await pw.persist_print_turn(
        chat_id=PRINT_CHAT,
        tenant_id=TENANT,
        raw_bytes=page_png(BASE),
        vision_data=vision_data(BASE),
        caption="Explain this print",
        answer="(photo-turn reply delivered by the cascade)",
    )
    print("ingest outcome:", outcome)
    ws = pw.get_workspace(PRINT_CHAT)
    print("workspace mapping:", ws)
    if ws is None:
        print("FAIL: no print workspace row — persistence broken")
        return False

    outcome2 = await pw.persist_print_turn(
        chat_id=PRINT_CHAT,
        tenant_id=TENANT,
        raw_bytes=page_png(CLOSE_UP_BASE),
        vision_data=vision_data(CLOSE_UP_BASE),
        caption="closer look at K17",
        answer="(close-up reply)",
    )
    print("close-up outcome:", outcome2)

    ok = True
    for q in (
        "What closes K17?",
        "I measured 24V across the K17 coil",
        "What devices are shown on this print?",
    ):
        claimed, reply = await _rung_turn(bot, "_try_print_workspace_followup", PRINT_CHAT, q)
        print(f"\nfollow-up {q!r} claimed={claimed}")
        print((reply or "(no reply)")[:600])
        ok = ok and claimed
    return ok


async def _equipment_section(bot) -> bool:
    print("=" * 60)
    print("SECTION 2 — equipment photo memory")
    print("=" * 60)
    if not hasattr(bot, "_try_equipment_photo_followup"):
        print("SKIP: deployed image predates the equipment rung (pre-photo-memory branch)")
        return True

    # Persist under the SAME tenant the rung's guard will resolve for this
    # chat (the rung re-validates workspace tenant against the current turn).
    eff_tenant = bot._print_workspace_tenant(_fake_update(EQUIP_CHAT)) or TENANT
    print(f"effective tenant for equipment section: {eff_tenant}")

    outcome = await pw.persist_print_turn(
        chat_id=EQUIP_CHAT,
        tenant_id=eff_tenant,
        raw_bytes=_png(),
        vision_data=dict(_EQUIP_VISION),
        caption="what is this motor?",
        answer="(equipment reply delivered by the engine)",
        nameplate_fields=dict(_EQUIP_FIELDS),
    )
    print("ingest outcome:", outcome)
    ws = pw.get_workspace(EQUIP_CHAT)
    print("workspace mapping:", ws)
    if ws is None or outcome is None:
        print("FAIL: no equipment workspace row — persistence broken")
        return False

    ok = True
    for q, expected in (
        ("what was the model number?", "AEHH8N"),
        ("who makes it?", "TECO"),
        ("what did that photo show?", "Nameplate fields I read"),
    ):
        claimed, reply = await _rung_turn(bot, "_try_equipment_photo_followup", EQUIP_CHAT, q)
        hit = expected.lower() in (reply or "").lower()
        print(f"\nfollow-up {q!r} claimed={claimed} contains({expected!r})={hit}")
        print((reply or "(no reply)")[:600])
        ok = ok and claimed and hit

    claimed, _reply = await _rung_turn(
        bot, "_try_equipment_photo_followup", EQUIP_CHAT, "I see smoke coming from that motor"
    )
    print(f"\nsafety turn claimed={claimed} (must be False — STOP gate owns it)")
    ok = ok and not claimed
    return ok


async def main() -> int:
    import bot  # deployed /app/bot.py

    ok1 = await _print_section(bot)
    ok2 = await _equipment_section(bot)
    print("\n" + "=" * 60)
    print(f"RESULT: {'PASS' if (ok1 and ok2) else 'FAIL'} (print={ok1} equipment={ok2})")
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
