-- 업적 뱃지 저장
CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL CHECK (badge_key IN ('genesis', 'streak', 'owl', 'storm', 'spotlight', 'champion')),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_key)
);

CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);

-- RLS
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_badges_read_authenticated" ON user_badges
  FOR SELECT USING (auth.role() = 'authenticated');

-- 쓰기는 service role만 가능 (크론 잡에서 사용)
-- RLS에 INSERT 정책이 없으면 일반 유저는 INSERT 불가, service role은 RLS 무시
