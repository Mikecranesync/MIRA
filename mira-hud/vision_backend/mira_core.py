"""
mira_core.py — MIRA Vision + RAG Orchestrator

Connects to server.js as a Socket.IO client.
Runs the vision loop, handles voice queries, processes typed questions from browser.

Usage:
    ANTHROPIC_API_KEY=sk-ant-... python mira_core.py

Environment variables:
    ANTHROPIC_API_KEY  — required for Claude Vision + RAG
    MIRA_SERVER_URL    — server.js URL (default: http://localhost:3000)
"""

import asyncio
import os
import sys
import time

import socketio

from vision_loop import get_frame, analyze_frame
from rag_engine import RAGEngine
from voice_handler import VoiceHandler

# ── Config ────────────────────────────────────────────────────────────────────

SERVER_URL = os.environ.get("MIRA_SERVER_URL", "http://localhost:3000")
API_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")

if not API_KEY:
    print("[WARN] ANTHROPIC_API_KEY not set — Claude calls disabled, UI still connects")

# ── Shared state ──────────────────────────────────────────────────────────────

sio   = socketio.AsyncClient(reconnection=True, reconnection_delay=2)
rag   = RAGEngine(api_key=API_KEY or None)
voice = VoiceHandler()

_equipment_context = ""   # updated on each visionUpdate
_voice_queue: asyncio.Queue = None  # set in main()


# ── Socket.IO event handlers ──────────────────────────────────────────────────

@sio.event
async def connect():
    print(f"[mira] connected to {SERVER_URL}")
    await sio.emit("registerPythonBackend", {})


@sio.event
async def disconnect():
    print("[mira] disconnected — will reconnect...")


@sio.on("visionUpdate")
async def on_vision_update(data):
    """Server re-broadcasts our own visionUpdate to all clients.
    Use this to keep equipment_context current without triggering another RAG call."""
    global _equipment_context
    eq  = data.get("equipment", "")
    mdl = data.get("model", "")
    _equipment_context = f"{eq} {mdl}".strip()


@sio.on("techQuery")
async def on_tech_query(data):
    """
    Handle typed queries emitted by the browser (source='text').
    Skip re-broadcasts of our own voice queries (source='voice') to avoid loops.
    """
    if data.get("source") != "text":
        return

    question = data.get("query", "").strip()
    if not question:
        return

    print(f"[mira] text query: \"{question}\"")
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, rag.query, question, _equipment_context)
    await sio.emit("miraResponse", result)


# ── Vision loop ───────────────────────────────────────────────────────────────

async def vision_loop():
    """
    Capture a frame every 3 seconds → Claude Vision → emit visionUpdate.
    If equipment identified → auto-RAG → emit miraResponse.
    """
    global _equipment_context
    loop = asyncio.get_event_loop()

    while True:
        try:
            frame = await loop.run_in_executor(None, get_frame)

            if frame and API_KEY:
                result = await loop.run_in_executor(
                    None, analyze_frame, frame, API_KEY
                )
                result["ts"] = time.time()

                eq  = result.get("equipment", "")
                mdl = result.get("model", "")
                _equipment_context = f"{eq} {mdl}".strip()

                await sio.emit("visionUpdate", result)

                # Auto-RAG: only when specific equipment is identified
                if eq and eq not in ("Unknown", "General environment", ""):
                    rag_result = await loop.run_in_executor(
                        None,
                        rag.query,
                        "What should the technician check or know about this equipment?",
                        _equipment_context,
                    )
                    await sio.emit("miraResponse", rag_result)

            elif not API_KEY:
                # Push a placeholder so HUD shows something useful
                await sio.emit("visionUpdate", {
                    "equipment": "Vision offline",
                    "model":    "--",
                    "observations": "Set ANTHROPIC_API_KEY env var to enable live vision.",
                    "alerts":   [],
                    "ts":       time.time(),
                })

        except Exception as exc:
            print(f"[vision] error: {exc}")

        await asyncio.sleep(3)


# ── Voice ─────────────────────────────────────────────────────────────────────

async def _handle_voice():
    """Record → transcribe → emit techQuery + miraResponse."""
    print("[voice] recording 5s — speak now...")
    try:
        transcript = await voice.capture_query()
        if not transcript:
            return

        await sio.emit("techQuery", {"query": transcript, "source": "voice"})

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, rag.query, transcript, _equipment_context
        )
        await sio.emit("miraResponse", result)

    except Exception as exc:
        print(f"[voice] error: {exc}")


async def voice_queue_loop():
    """Drain the spacebar trigger queue and process each voice capture."""
    while True:
        await _voice_queue.get()
        await _handle_voice()


def _start_keyboard_listener(loop: asyncio.AbstractEventLoop):
    """
    Start a pynput keyboard listener in a daemon thread.
    Spacebar press → puts a signal on the asyncio queue.
    """
    try:
        from pynput import keyboard  # noqa: PLC0415
    except ImportError:
        print("[voice] pynput not installed — spacebar disabled")
        print("        Install with: pip install pynput")
        return

    _held: set = set()

    def on_press(key):
        if key == keyboard.Key.space and key not in _held:
            _held.add(key)
            asyncio.run_coroutine_threadsafe(_voice_queue.put(True), loop)

    def on_release(key):
        _held.discard(key)

    listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    listener.daemon = True
    listener.start()
    print("[voice] spacebar listener active — press SPACE to record a query")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    global _voice_queue
    _voice_queue = asyncio.Queue()

    loop = asyncio.get_event_loop()
    _start_keyboard_listener(loop)

    print(f"[mira] connecting to {SERVER_URL}...")
    await sio.connect(SERVER_URL)

    await asyncio.gather(
        vision_loop(),
        voice_queue_loop(),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[mira] shutdown")
        sys.exit(0)
