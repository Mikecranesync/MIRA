# MIRA Vision Backend

Live equipment identification + RAG-powered maintenance assistant.
Connects to `server.js` as a Socket.IO client and drives the center HUD panels.

## Requirements

- Python 3.10+
- PortAudio (for microphone): `brew install portaudio`
- ffmpeg (for Whisper): `brew install ffmpeg`
- Anthropic API key

## Install

```bash
cd mira-hud/vision_backend
pip install -r requirements.txt
```

## Run

```bash
# server.js must be running first (cd mira-hud && node server.js)

ANTHROPIC_API_KEY=sk-ant-... python mira_core.py
```

Optional env vars:
```bash
MIRA_SERVER_URL=http://localhost:3000   # default
```

## What it does

| Loop | Interval | Action |
|------|----------|--------|
| Vision | Every 3s | Captures webcam frame → Claude Vision → emits `visionUpdate` |
| Auto-RAG | After vision | If equipment identified → searches docs → emits `miraResponse` |
| Voice | SPACE key | Records 5s → Whisper → searches docs → emits `miraResponse` |
| Text query | From browser | Browser query bar → `techQuery` event → RAG → `miraResponse` |

## Adding documentation

Drop any `.txt` file into `vision_backend/docs/` and restart `mira_core.py`.
The RAG engine auto-indexes all `.txt` files on startup.

File naming convention: `{equipment_name}.txt` (e.g., `abb_irb2600_robot.txt`)

Format: plain text, paragraph-separated. No special markup needed.
Include: model identification, fault codes, parameter tables, wiring, reset procedures.

### Included sample docs

| File | Covers |
|------|--------|
| `gs2_vfd.txt` | AutomationDirect GS2/GS10 VFD — fault codes, parameters, Modbus map |
| `micro820_plc.txt` | Allen-Bradley Micro820 PLC — faults, I/O, EtherNet/IP, Modbus |

## Swapping to Halo glasses (Phase 2)

Two one-line changes:

**vision_loop.py** — `get_frame()` function:
```python
# Comment out webcam lines, uncomment HALO lines:
# HALO: glasses = await get_glasses()
# HALO: return await glasses.camera.capture()
```

**voice_handler.py** — `VoiceHandler.record_audio()`:
```python
# Comment out sounddevice lines, uncomment HALO lines:
# HALO: glasses = await get_glasses()
# HALO: raw = await glasses.microphone.stream(sample_rate=16000, seconds=seconds)
# HALO: return _save_wav(raw, SAMPLE_RATE)
```

Install the Frame SDK: `pip install frame-sdk`

## Architecture

```
mira_core.py
├── vision_loop() ──→ get_frame() → analyze_frame() → sio.emit('visionUpdate')
│                                                    → rag.query() → sio.emit('miraResponse')
├── voice_queue_loop() ← spacebar (pynput thread)
│   └── _handle_voice() → voice.capture_query() → rag.query() → sio.emit('miraResponse')
└── on_tech_query() ← browser query bar → rag.query() → sio.emit('miraResponse')
```

All events flow through `server.js` which re-broadcasts to all browser clients.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `sounddevice.PortAudioError` | `brew install portaudio` then reinstall sounddevice |
| `No module named 'whisper'` | `pip install openai-whisper` |
| Webcam not found | Check camera permissions in System Settings → Privacy → Camera |
| `Connection refused` | Start server.js first: `cd mira-hud && node server.js` |
| Spacebar not working | `pip install pynput` — macOS may require Accessibility permission |
| Vision panel shows "API key not configured" | Set `ANTHROPIC_API_KEY` env var |
