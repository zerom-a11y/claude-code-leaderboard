-- rate limit 스냅샷 테이블
CREATE TABLE rate_limit_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  five_hour_pct NUMERIC NOT NULL DEFAULT 0,
  five_hour_resets_at TIMESTAMPTZ,
  seven_day_pct NUMERIC NOT NULL DEFAULT 0,
  seven_day_resets_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rate_limit_user_created ON rate_limit_snapshots(user_id, created_at DESC);

-- RLS
ALTER TABLE rate_limit_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limit_read_authenticated" ON rate_limit_snapshots
  FOR SELECT USING (auth.role() = 'authenticated');
