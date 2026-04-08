-- Migration 003: YouTube KB tables
-- Run against NeonDB (psql $NEON_DATABASE_URL -f 003_youtube_kb.sql)

-- Video inventory + per-video processing state machine
CREATE TABLE IF NOT EXISTS youtube_videos (
    video_id          TEXT PRIMARY KEY,
    channel_id        TEXT NOT NULL,
    channel_name      TEXT,
    title             TEXT NOT NULL,
    duration_s        INTEGER,
    view_count        BIGINT,
    like_count        BIGINT,
    published_at      TIMESTAMP,
    -- State machine: pending | done | failed | no_captions
    transcript_status TEXT NOT NULL DEFAULT 'pending',
    -- State machine: pending | done | failed
    keyframe_status   TEXT NOT NULL DEFAULT 'pending',
    -- State machine: pending | done | failed
    pattern_status    TEXT NOT NULL DEFAULT 'pending',
    error_msg         TEXT,
    queued_at         TIMESTAMP NOT NULL DEFAULT now(),
    updated_at        TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS youtube_videos_transcript_status_idx
    ON youtube_videos (transcript_status);
CREATE INDEX IF NOT EXISTS youtube_videos_keyframe_status_idx
    ON youtube_videos (keyframe_status);
CREATE INDEX IF NOT EXISTS youtube_videos_pattern_status_idx
    ON youtube_videos (pattern_status);

-- Extracted teaching structure patterns from transcript analysis
CREATE TABLE IF NOT EXISTS teaching_patterns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_video_id  TEXT NOT NULL REFERENCES youtube_videos (video_id) ON DELETE CASCADE,
    pattern_json     JSONB NOT NULL,
    -- view_count / channel_median_views — higher = more engaging educator
    engagement_score FLOAT,
    created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teaching_patterns_engagement_idx
    ON teaching_patterns (engagement_score DESC NULLS LAST);
