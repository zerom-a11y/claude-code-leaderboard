# Achievement Badges (행동 기반 업적 뱃지) 설계

## 개요

기존 토큰 티어 뱃지(🌱~👑)와 별도로, 사용자의 행동 패턴에 기반한 **업적 뱃지 6종**을 추가한다. 뱃지는 한 번 획득하면 영구 보유되며, Vercel Cron으로 매일 자정(KST) 판정한다.

## 뱃지 목록

| # | key | 이름 | 이모지 | 조건 |
|---|-----|------|--------|------|
| 1 | genesis | Genesis | 🐣 | 첫 세션 리포트 완료 |
| 2 | streak | Streak | 🔥 | 7일 연속 세션 리포트 |
| 3 | owl | Owl | 🦉 | 새벽(00:00~06:00 KST) 세션 3회 이상 |
| 4 | storm | Storm | ⚡ | 하루(KST 기준) 토큰 합계 10M 이상 달성 |
| 5 | spotlight | Spotlight | 🏅 | 일간 리더보드 Top 5 진입 |
| 6 | champion | Champion | 🏆 | 주간 리더보드 1위 달성 |

## DB 스키마

### 신규 테이블: `user_badges`

```sql
CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL CHECK (badge_key IN ('genesis', 'streak', 'owl', 'storm', 'spotlight', 'champion')),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_key)
);

CREATE INDEX idx_user_badges_user_id ON user_badges(user_id);
```

- 영구 획득: INSERT만 존재, DELETE 로직 없음
- `ON CONFLICT DO NOTHING`으로 중복 방지
- RLS: 인증된 사용자 누구나 읽기 가능, 쓰기는 service role만

## 크론 잡

### 엔드포인트

`GET /api/cron/badges`

### 스케줄

매일 00:05 KST (UTC 15:05) — `vercel.json`에 등록:

```json
{
  "crons": [{
    "path": "/api/cron/badges",
    "schedule": "5 15 * * *"
  }]
}
```

### 인증

`Authorization: Bearer <CRON_SECRET>` 헤더 검증. Vercel이 자동으로 주입하는 `CRON_SECRET` 환경변수 사용.

### 판정 로직

전체 유저를 대상으로, 이미 획득한 뱃지는 스킵하고 미획득 뱃지만 체크한다.

| 뱃지 | 판정 쿼리 |
|------|----------|
| genesis | `sessions` 테이블에 해당 user_id 레코드 1건 이상 |
| streak | 세션 날짜(KST)를 추출하여, 연속 7일 이상 구간 존재 여부 |
| owl | `created_at` AT TIME ZONE 'Asia/Seoul'의 시각이 00:00~06:00인 세션 3건 이상 |
| storm | 같은 날(KST) 세션 `total_tokens` 합계가 10,000,000 이상인 날 존재 |
| spotlight | 임의의 날(KST)에 해당 유저의 토큰 합계가 상위 5위 이내 |
| champion | 임의의 주(월~일, KST)에 해당 유저의 토큰 합계가 1위 |

## API 변경

### `GET /api/leaderboard` 수정

- `user_badges` 테이블을 조인하여 각 유저의 뱃지 목록 포함
- 응답 필드 추가: `badges: string[]` (예: `["genesis", "owl", "storm"]`)

### `GET /api/me` 수정

- 프로필 조회 시 획득 뱃지 목록 + 각 뱃지의 `earned_at` 포함

## 프론트엔드

### 리더보드 테이블 (`LeaderboardTable.tsx`)

컬럼 구조:

| 순위 | 닉네임 / 한마디 | 업적 | 소속 | 사용량 |
|------|----------------|------|------|--------|
| 1 | 💎 제롬 `나는야 AI 덕후` | 🐣🔥🦉 | CX본부 | 12.5M |

- 기존 티어 뱃지(🌱~👑)는 닉네임 앞에 붙는 현재 방식 유지
- **"업적" 컬럼 신규 추가**: 획득한 뱃지 이모지를 나열, 미획득 시 빈 칸

### 마이페이지 (`my/page.tsx`)

- 뱃지 섹션 추가: 6개 뱃지를 카드 그리드로 표시
- 획득한 뱃지: 컬러 + 이름 + 획득일
- 미획득 뱃지: grayscale 처리 + 조건 설명
- 각 뱃지에 마우스 오버 시 이름과 조건 설명 툴팁

### 뱃지 상수 정의

프론트엔드에 뱃지 메타데이터 상수를 정의하여 이모지, 이름, 설명을 관리:

```typescript
const ACHIEVEMENT_BADGES = [
  { key: 'genesis', emoji: '🐣', name: 'Genesis', description: '첫 세션 리포트 완료' },
  { key: 'streak', emoji: '🔥', name: 'Streak', description: '7일 연속 사용' },
  { key: 'owl', emoji: '🦉', name: 'Owl', description: '새벽(00~06시) 세션 3회' },
  { key: 'storm', emoji: '⚡', name: 'Storm', description: '하루 10M+ 토큰 사용' },
  { key: 'spotlight', emoji: '🏅', name: 'Spotlight', description: '일간 Top 5 진입' },
  { key: 'champion', emoji: '🏆', name: 'Champion', description: '주간 1위 달성' },
] as const;
```
