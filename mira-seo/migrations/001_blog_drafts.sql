CREATE TABLE IF NOT EXISTS blog_drafts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT        UNIQUE NOT NULL,
  draft_type      TEXT        NOT NULL CHECK (draft_type IN ('article', 'fault_code')),
  status          TEXT        NOT NULL DEFAULT 'pending_review'
                              CHECK (status IN ('pending_review', 'live', 'archived', 'rejected')),
  content_json    JSONB       NOT NULL,
  telegram_msg_id BIGINT,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blog_drafts_type_status ON blog_drafts (draft_type, status);
CREATE INDEX IF NOT EXISTS idx_blog_drafts_slug ON blog_drafts (slug);
