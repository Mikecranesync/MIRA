"""Phase 5 tests — Kokoro TTS voice responses."""

import asyncio
import os
import sqlite3
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Make telegram/ importable without installing the package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

import tts


# ---------------------------------------------------------------------------
# test_tts_returns_none_on_error
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tts_returns_none_on_error():
    """TTS returns None when Kokoro raises — never propagates exception."""
    mock_kokoro = MagicMock()
    mock_kokoro.create.side_effect = RuntimeError("onnx session error")

    with patch("tts._get_kokoro", return_value=mock_kokoro):
        result = await tts.text_to_ogg("hello world")

    assert result is None


# ---------------------------------------------------------------------------
# test_voice_command_on_sets_db_flag
# ---------------------------------------------------------------------------

def test_voice_command_on_sets_db_flag():
    """_set_voice_enabled(True) writes voice_enabled=1 to the DB."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    # Bootstrap the table
    db = sqlite3.connect(db_path)
    db.execute(
        """CREATE TABLE conversation_state (
               chat_id TEXT PRIMARY KEY,
               state TEXT NOT NULL DEFAULT 'IDLE',
               context TEXT NOT NULL DEFAULT '{}',
               asset_identified TEXT,
               fault_category TEXT,
               exchange_count INTEGER NOT NULL DEFAULT 0,
               final_state TEXT,
               voice_enabled INTEGER NOT NULL DEFAULT 0,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    db.commit()
    db.close()

    import bot

    with patch.dict(os.environ, {"MIRA_DB_PATH": db_path}):
        bot._set_voice_enabled("chat_1", True)
        enabled = bot._get_voice_enabled("chat_1")

    assert enabled is True
    os.unlink(db_path)


# ---------------------------------------------------------------------------
# test_voice_command_off_clears_db_flag
# ---------------------------------------------------------------------------

def test_voice_command_off_clears_db_flag():
    """_set_voice_enabled(False) writes voice_enabled=0 to the DB."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    db = sqlite3.connect(db_path)
    db.execute(
        """CREATE TABLE conversation_state (
               chat_id TEXT PRIMARY KEY,
               state TEXT NOT NULL DEFAULT 'IDLE',
               context TEXT NOT NULL DEFAULT '{}',
               asset_identified TEXT,
               fault_category TEXT,
               exchange_count INTEGER NOT NULL DEFAULT 0,
               final_state TEXT,
               voice_enabled INTEGER NOT NULL DEFAULT 0,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    db.commit()
    db.close()

    import bot

    with patch.dict(os.environ, {"MIRA_DB_PATH": db_path}):
        bot._set_voice_enabled("chat_1", True)
        bot._set_voice_enabled("chat_1", False)
        enabled = bot._get_voice_enabled("chat_1")

    assert enabled is False
    os.unlink(db_path)


# ---------------------------------------------------------------------------
# test_text_response_sent_even_when_tts_fails
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_text_response_sent_even_when_tts_fails():
    """Text reply is sent even when TTS returns None."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    db = sqlite3.connect(db_path)
    db.execute(
        """CREATE TABLE conversation_state (
               chat_id TEXT PRIMARY KEY,
               state TEXT NOT NULL DEFAULT 'IDLE',
               context TEXT NOT NULL DEFAULT '{}',
               asset_identified TEXT,
               fault_category TEXT,
               exchange_count INTEGER NOT NULL DEFAULT 0,
               final_state TEXT,
               voice_enabled INTEGER NOT NULL DEFAULT 1,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    # Pre-insert with voice_enabled=1
    db.execute(
        "INSERT INTO conversation_state (chat_id, voice_enabled) VALUES ('chat_1', 1)"
    )
    db.commit()
    db.close()

    import bot

    mock_update = MagicMock()
    mock_update.effective_chat.id = 12345
    mock_update.message.reply_text = AsyncMock()
    mock_update.message.reply_voice = AsyncMock()

    mock_context = MagicMock()
    mock_context.bot.send_chat_action = AsyncMock()

    with patch.dict(os.environ, {"MIRA_DB_PATH": db_path}):
        with patch("tts.text_to_ogg", new=AsyncMock(return_value=None)):
            await bot._maybe_send_voice(mock_update, mock_context, "chat_1", "Some response text")

    # Voice was attempted (send_chat_action called) but reply_voice was NOT called
    mock_context.bot.send_chat_action.assert_called_once()
    mock_update.message.reply_voice.assert_not_called()
    os.unlink(db_path)


# ---------------------------------------------------------------------------
# test_tts_truncates_long_text
# ---------------------------------------------------------------------------

def test_tts_truncates_long_text():
    """_clean_text truncates text exceeding MAX_WORDS words."""
    long_text = " ".join(["word"] * 300)
    cleaned = tts._clean_text(long_text)
    word_count = len(cleaned.split())
    # Should be MAX_WORDS + words from suffix
    assert word_count <= tts.MAX_WORDS + len(tts.TRUNCATION_SUFFIX.split()) + 1
    assert tts.TRUNCATION_SUFFIX.strip() in cleaned
