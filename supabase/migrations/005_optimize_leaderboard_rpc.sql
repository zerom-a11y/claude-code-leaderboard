-- 리더보드 RPC 함수 최적화: 기간별 + 누적 토큰을 한 번의 쿼리로 집계
-- since_date를 직접 받아서 API 측에서 KST 기반 날짜 계산 후 전달
CREATE OR REPLACE FUNCTION get_leaderboard(since_date TIMESTAMPTZ, role_filter TEXT)
RETURNS TABLE (
  user_id UUID,
  nickname TEXT,
  department TEXT,
  role TEXT,
  buddy BOOLEAN,
  bio TEXT,
  total_tokens BIGINT,
  all_time_tokens BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id as user_id,
    u.nickname,
    u.department,
    u.role,
    u.buddy,
    u.bio,
    COALESCE(SUM(s.total_tokens) FILTER (WHERE since_date IS NULL OR s.created_at >= since_date), 0)::BIGINT as total_tokens,
    COALESCE(SUM(s.total_tokens), 0)::BIGINT as all_time_tokens
  FROM users u
  LEFT JOIN sessions s ON s.user_id = u.id
  WHERE
    CASE
      WHEN role_filter = 'all' THEN TRUE
      ELSE u.role = role_filter
    END
  GROUP BY u.id, u.nickname, u.department, u.role, u.buddy, u.bio
  HAVING COALESCE(SUM(s.total_tokens) FILTER (WHERE since_date IS NULL OR s.created_at >= since_date), 0) > 0
  ORDER BY total_tokens DESC;
END;
$$;
