"""
vision_loop.py — Frame capture + Claude Vision analysis

Phase 1: Mac webcam (cv2.VideoCapture)
Phase 2 (Halo): uncomment HALO lines, comment webcam lines

Swap point: get_frame() — everything downstream is identical.
"""

import base64
import json

import cv2
import anthropic

# HALO: from frame_sdk import Frame
# HALO: _glasses = None
# HALO: async def get_glasses():
# HALO:     global _glasses
# HALO:     if _glasses is None:
# HALO:         _glasses = Frame()
# HALO:         await _glasses.connect()
# HALO:     return _glasses

VISION_PROMPT = (
    "You are an industrial equipment assistant analyzing a camera frame. "
    "Identify any equipment visible. Return ONLY valid JSON with this exact structure:\n"
    '{"equipment": "equipment type or \'Unknown\'", '
    '"model": "brand and model if visible or \'Unknown\'", '
    '"observations": "1-2 sentence description of what you see", '
    '"alerts": ["safety concerns or fault indicators — empty list if none"]}\n'
    "If no industrial equipment is visible, set equipment to \"General environment\" "
    "and describe the scene in observations."
)


def get_frame() -> bytes | None:
    """
    Capture one JPEG frame from the Mac webcam.
    Returns JPEG bytes or None on failure.

    HALO swap: replace this function body with:
        glasses = await get_glasses()
        return await glasses.camera.capture()
    """
    # HALO: glasses = await get_glasses()
    # HALO: return await glasses.camera.capture()

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        return None
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return None
    _, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return jpeg.tobytes()


def analyze_frame(image_bytes: bytes, api_key: str) -> dict:
    """
    Send a JPEG frame to Claude Vision API.
    Returns a dict: {equipment, model, observations, alerts}
    """
    client = anthropic.Anthropic(api_key=api_key)
    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": b64,
                        },
                    },
                    {"type": "text", "text": VISION_PROMPT},
                ],
            }
        ],
    )

    text = message.content[0].text.strip()

    # Strip markdown code fences if Claude wrapped the JSON
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fallback: return raw observation
        return {
            "equipment": "Unknown",
            "model": "Unknown",
            "observations": text[:200],
            "alerts": [],
        }
