-- Migration: add voice_enabled column to conversation_state (v1.2.0)
-- Run: sqlite3 mira.db < migrations/002_add_voice_enabled.sql

ALTER TABLE conversation_state ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0;
