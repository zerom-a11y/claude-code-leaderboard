# Achievement Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 행동 기반 업적 뱃지 6종(Genesis, Streak, Owl, Storm, Spotlight, Champion)을 추가하여 리더보드에 게이미피케이션 요소를 강화한다.

**Architecture:** `user_badges` 테이블에 획득 뱃지를 영구 저장하고, Vercel Cron이 매일 자정(KST) `/api/cron/badges`를 호출하여 판정한다. 기존 `/api/leaderboard`와 `/api/me` API에 뱃지 데이터를 추가하고, 리더보드 테이블에 "업적" 컬럼, 마이페이지에 뱃지 카드 그리드를 렌더링한다.

**Tech Stack:** Next.js 16 (App Router), Supabase (PostgreSQL), Vercel Cron, TypeScript, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-04-09-achievement-badges-design.md`

**Important:** This project uses Next.js 16 which has breaking changes. Before writing any code, read the relevant guide in `node_modules/next/dist/docs/` if you encounter unexpected API behavior.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/003_achievement_badges.sql` | user_badges 테이블, RLS, 인덱스 |
| Create | `src/lib/badges.ts` | 뱃지 상수 정의 + 판정 로직 (서버/클라이언트 공용) |
| Create | `src/app/api/cron/badges/route.ts` | 크론 엔드포인트: 전체 유저 뱃지 판정 |
| Create | `vercel.json` | Vercel Cron 스케줄 등록 |
| Modify | `src/app/api/leaderboard/route.ts` | 응답에 badges 필드 추가 |
| Modify | `src/app/api/me/route.ts` | 응답에 badges 필드 추가 |
| Modify | `src/components/LeaderboardTable.tsx` | "업적" 컬럼 추가 |
| Modify | `src/app/my/page.tsx` | 뱃지 카드 그리드 섹션 추가 |

---

### Task 1: DB 마이그레이션 — user_badges 테이블

**Files:**
- Create: `supabase/migrations/003_achievement_badges.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
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
```

- [ ] **Step 2: Supabase 대시보드에서 마이그레이션 실행**

Supabase SQL Editor에서 위 SQL을 실행하여 테이블 생성 확인.
Expected: `user_badges` 테이블이 생성되고 RLS가 활성화됨.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/003_achievement_badges.sql
git commit -m "feat: user_badges 테이블 마이그레이션 추가"
```

---

### Task 2: 뱃지 상수 및 판정 로직

**Files:**
- Create: `src/lib/badges.ts`

- [ ] **Step 1: 뱃지 상수와 타입 정의**

```typescript
export const ACHIEVEMENT_BADGES = [
  { key: 'genesis', emoji: '🐣', name: 'Genesis', description: '첫 세션 리포트 완료' },
  { key: 'streak', emoji: '🔥', name: 'Streak', description: '7일 연속 사용' },
  { key: 'owl', emoji: '🦉', name: 'Owl', description: '새벽(00~06시) 세션 3회' },
  { key: 'storm', emoji: '⚡', name: 'Storm', description: '하루 10M+ 토큰 사용' },
  { key: 'spotlight', emoji: '🏅', name: 'Spotlight', description: '일간 Top 5 진입' },
  { key: 'champion', emoji: '🏆', name: 'Champion', description: '주간 1위 달성' },
] as const

export type BadgeKey = typeof ACHIEVEMENT_BADGES[number]['key']

export function getBadgeEmojis(badgeKeys: string[]): string {
  return ACHIEVEMENT_BADGES
    .filter(b => badgeKeys.includes(b.key))
    .map(b => b.emoji)
    .join('')
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/badges.ts
git commit -m "feat: 뱃지 상수 및 유틸 함수 정의"
```

---

### Task 3: 크론 엔드포인트 — 뱃지 판정 로직

**Files:**
- Create: `src/app/api/cron/badges/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: 크론 라우트 작성**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import type { BadgeKey } from '@/lib/badges'

export async function GET(request: NextRequest) {
  // Vercel Cron 인증
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // 전체 유저 ID 조회
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id')
  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 })

  // 기존 뱃지 조회 (이미 획득한 건 스킵)
  const { data: existingBadges } = await supabase
    .from('user_badges')
    .select('user_id, badge_key')
  const earnedSet = new Set(
    (existingBadges || []).map(b => `${b.user_id}:${b.badge_key}`)
  )

  // 전체 세션 조회
  const { data: sessions } = await supabase
    .from('sessions')
    .select('user_id, total_tokens, created_at')
  const allSessions = sessions || []

  const newBadges: { user_id: string; badge_key: BadgeKey }[] = []

  for (const user of users || []) {
    const uid = user.id
    const userSessions = allSessions.filter(s => s.user_id === uid)

    // --- Genesis: 세션 1건 이상 ---
    if (!earnedSet.has(`${uid}:genesis`) && userSessions.length > 0) {
      newBadges.push({ user_id: uid, badge_key: 'genesis' })
    }

    // --- Streak: 연속 7일 ---
    if (!earnedSet.has(`${uid}:streak`) && userSessions.length > 0) {
      const dates = [...new Set(userSessions.map(s => {
        const d = new Date(s.created_at)
        return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
      }))].sort()

      let maxStreak = 1
      let currentStreak = 1
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1])
        const curr = new Date(dates[i])
        const diffDays = (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000)
        if (diffDays === 1) {
          currentStreak++
          maxStreak = Math.max(maxStreak, currentStreak)
        } else {
          currentStreak = 1
        }
      }
      if (maxStreak >= 7) {
        newBadges.push({ user_id: uid, badge_key: 'streak' })
      }
    }

    // --- Owl: 새벽(00~06 KST) 세션 3회 ---
    if (!earnedSet.has(`${uid}:owl`)) {
      const owlCount = userSessions.filter(s => {
        const d = new Date(s.created_at)
        const kstHour = new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCHours()
        return kstHour >= 0 && kstHour < 6
      }).length
      if (owlCount >= 3) {
        newBadges.push({ user_id: uid, badge_key: 'owl' })
      }
    }

    // --- Storm: 하루 10M+ 토큰 ---
    if (!earnedSet.has(`${uid}:storm`)) {
      const dailyTotals = new Map<string, number>()
      userSessions.forEach(s => {
        const d = new Date(s.created_at)
        const date = new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
        dailyTotals.set(date, (dailyTotals.get(date) || 0) + (s.total_tokens || 0))
      })
      const hasStormDay = [...dailyTotals.values()].some(t => t >= 10_000_000)
      if (hasStormDay) {
        newBadges.push({ user_id: uid, badge_key: 'storm' })
      }
    }
  }

  // --- Spotlight: 일간 Top 5 ---
  // 날짜별로 전체 유저의 토큰 합산 후 Top 5 판정
  const dailyUserTotals = new Map<string, Map<string, number>>()
  for (const s of allSessions) {
    const d = new Date(s.created_at)
    const date = new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
    if (!dailyUserTotals.has(date)) dailyUserTotals.set(date, new Map())
    const dayMap = dailyUserTotals.get(date)!
    dayMap.set(s.user_id, (dayMap.get(s.user_id) || 0) + (s.total_tokens || 0))
  }

  const spotlightUsers = new Set<string>()
  for (const [, dayMap] of dailyUserTotals) {
    const sorted = [...dayMap.entries()].sort((a, b) => b[1] - a[1])
    sorted.slice(0, 5).forEach(([uid]) => spotlightUsers.add(uid))
  }
  for (const uid of spotlightUsers) {
    if (!earnedSet.has(`${uid}:spotlight`)) {
      newBadges.push({ user_id: uid, badge_key: 'spotlight' })
    }
  }

  // --- Champion: 주간 1위 ---
  // 주(월~일, KST)별로 전체 유저의 토큰 합산 후 1위 판정
  const weeklyUserTotals = new Map<string, Map<string, number>>()
  for (const s of allSessions) {
    const d = new Date(s.created_at)
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    const day = kst.getUTCDay()
    const daysSinceMonday = (day + 6) % 7
    const monday = new Date(kst.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000)
    const weekKey = monday.toISOString().split('T')[0]
    if (!weeklyUserTotals.has(weekKey)) weeklyUserTotals.set(weekKey, new Map())
    const weekMap = weeklyUserTotals.get(weekKey)!
    weekMap.set(s.user_id, (weekMap.get(s.user_id) || 0) + (s.total_tokens || 0))
  }

  for (const [, weekMap] of weeklyUserTotals) {
    const sorted = [...weekMap.entries()].sort((a, b) => b[1] - a[1])
    if (sorted.length > 0) {
      const uid = sorted[0][0]
      if (!earnedSet.has(`${uid}:champion`)) {
        newBadges.push({ user_id: uid, badge_key: 'champion' })
      }
    }
  }

  // 새 뱃지 일괄 삽입
  if (newBadges.length > 0) {
    const { error: insertError } = await supabase
      .from('user_badges')
      .upsert(
        newBadges.map(b => ({ user_id: b.user_id, badge_key: b.badge_key })),
        { onConflict: 'user_id,badge_key', ignoreDuplicates: true }
      )
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    awarded: newBadges.length,
    details: newBadges,
  })
}
```

- [ ] **Step 2: vercel.json 작성**

```json
{
  "crons": [
    {
      "path": "/api/cron/badges",
      "schedule": "5 15 * * *"
    }
  ]
}
```

`5 15 * * *` = 매일 UTC 15:05 = KST 00:05

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cron/badges/route.ts vercel.json
git commit -m "feat: 뱃지 판정 크론 엔드포인트 추가"
```

---

### Task 4: Leaderboard API에 뱃지 데이터 추가

**Files:**
- Modify: `src/app/api/leaderboard/route.ts`

- [ ] **Step 1: user_badges 조회 추가**

`src/app/api/leaderboard/route.ts`의 `try` 블록 안에서, users 조회 후 뱃지를 추가로 조회한다.

기존 코드 (90행 `const { data: users, error: usersError } = await usersQuery` 이후)에 뱃지 조회를 추가:

```typescript
    // 뱃지 조회
    const { data: badges } = await serviceClient
      .from('user_badges')
      .select('user_id, badge_key')
      .in('user_id', userIds)

    const userBadgesMap = new Map<string, string[]>()
    for (const b of badges || []) {
      const list = userBadgesMap.get(b.user_id) || []
      list.push(b.badge_key)
      userBadgesMap.set(b.user_id, list)
    }
```

- [ ] **Step 2: 응답 객체에 badges 필드 추가**

기존 `result`의 `.map(u => ({...}))` 안에 `badges` 필드를 추가:

```typescript
    const result = (users || [])
      .map(u => ({
        user_id: u.id,
        nickname: u.nickname,
        department: u.department,
        role: u.role,
        buddy: u.buddy ?? false,
        bio: u.bio || '',
        total_tokens: userTotals.get(u.id) || 0,
        all_time_tokens: userAllTimeTotals.get(u.id) || 0,
        badges: userBadgesMap.get(u.id) || [],
        isMe: u.id === user.id,
      }))
      .filter(u => u.total_tokens > 0)
      .sort((a, b) => b.total_tokens - a.total_tokens)
      .map((u, i) => ({ ...u, rank: i + 1 }))
```

- [ ] **Step 3: 로컬에서 API 응답 확인**

Run: `npm run dev`
브라우저에서 `/api/leaderboard?period=all&role=all` 호출.
Expected: 각 유저 객체에 `badges: []` (또는 뱃지 키 배열) 필드가 포함됨.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/leaderboard/route.ts
git commit -m "feat: leaderboard API 응답에 badges 필드 추가"
```

---

### Task 5: Me API에 뱃지 데이터 추가

**Files:**
- Modify: `src/app/api/me/route.ts`

- [ ] **Step 1: GET 핸들러에 뱃지 조회 추가**

기존 `GET` 함수에서 profile과 sessions 조회 후, 뱃지도 함께 조회:

```typescript
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('*').eq('id', user.id).single()

  const { data: sessions } = await supabase
    .from('sessions')
    .select('input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const { data: badges } = await supabase
    .from('user_badges')
    .select('badge_key, earned_at')
    .eq('user_id', user.id)

  return NextResponse.json({ profile, sessions, badges: badges || [] })
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/me/route.ts
git commit -m "feat: me API 응답에 badges 필드 추가"
```

---

### Task 6: 리더보드 테이블에 "업적" 컬럼 추가

**Files:**
- Modify: `src/components/LeaderboardTable.tsx`

- [ ] **Step 1: Entry 타입에 badges 추가 & ACHIEVEMENT_BADGES import**

```typescript
'use client'

import { ACHIEVEMENT_BADGES } from '@/lib/badges'

type Entry = {
  rank: number
  nickname: string
  department: string
  total_tokens: number
  all_time_tokens: number
  badges?: string[]
  buddy?: boolean
  bio?: string
  isMe?: boolean
}
```

- [ ] **Step 2: 테이블 헤더에 "업적" 컬럼 추가**

기존 헤더의 "닉네임" 뒤에 "업적" 컬럼 추가:

```html
<thead>
  <tr className="border-b border-gray-800 text-gray-400 text-sm">
    <th className="py-3 px-4 text-left w-16">#</th>
    <th className="py-3 px-4 text-left">닉네임</th>
    <th className="py-3 px-2 text-left whitespace-nowrap">업적</th>
    <th className="py-3 pl-0 pr-4 text-left whitespace-nowrap">부서</th>
    <th className="py-3 px-4 text-right whitespace-nowrap">사용량</th>
  </tr>
</thead>
```

- [ ] **Step 3: 테이블 바디에 업적 셀 추가**

닉네임 `<td>` 뒤에 업적 셀 추가:

```html
<td className="py-3 px-2 whitespace-nowrap" title={
  (entry.badges || [])
    .map(key => ACHIEVEMENT_BADGES.find(b => b.key === key))
    .filter(Boolean)
    .map(b => `${b!.emoji} ${b!.name}: ${b!.description}`)
    .join('\n')
}>
  {(entry.badges || [])
    .map(key => ACHIEVEMENT_BADGES.find(b => b.key === key)?.emoji)
    .filter(Boolean)
    .join('')}
</td>
```

- [ ] **Step 4: 로컬에서 UI 확인**

Run: `npm run dev`
브라우저에서 리더보드 페이지 확인.
Expected: 닉네임과 부서 사이에 "업적" 컬럼이 표시됨. 뱃지가 없으면 빈 칸.

- [ ] **Step 5: 커밋**

```bash
git add src/components/LeaderboardTable.tsx
git commit -m "feat: 리더보드 테이블에 업적 컬럼 추가"
```

---

### Task 7: 마이페이지에 뱃지 카드 그리드 추가

**Files:**
- Modify: `src/app/my/page.tsx`

- [ ] **Step 1: ACHIEVEMENT_BADGES import 및 badges 상태 추가**

파일 상단에 import 추가:

```typescript
import { ACHIEVEMENT_BADGES } from '@/lib/badges'
```

`MyPage` 컴포넌트 안에 badges 상태 추가:

```typescript
const [badges, setBadges] = useState<{ badge_key: string; earned_at: string }[]>([])
```

기존 `useEffect`의 fetch 콜백에서 badges도 세팅:

```typescript
useEffect(() => {
  fetch('/api/me')
    .then(res => res.json())
    .then(json => {
      setProfile(json.profile)
      setSessions(json.sessions || [])
      setBio(json.profile?.bio || '')
      setBadges(json.badges || [])
      setLoading(false)
    })
    .catch(() => setLoading(false))
}, [])
```

- [ ] **Step 2: 뱃지 카드 그리드 UI 추가**

`return` 문 안에서, 프로필 카드 그리드(`grid-cols-3`) 아래에 뱃지 섹션 추가:

```html
<div className="bg-gray-100 rounded-lg p-4">
  <h2 className="text-sm text-gray-500 mb-3">업적 뱃지</h2>
  <div className="grid grid-cols-3 gap-3">
    {ACHIEVEMENT_BADGES.map(badge => {
      const earned = badges.find(b => b.badge_key === badge.key)
      return (
        <div
          key={badge.key}
          className={`rounded-lg p-3 text-center ${
            earned ? 'bg-white' : 'bg-gray-200 opacity-40'
          }`}
          title={earned
            ? `${badge.name}: ${badge.description} (${new Date(earned.earned_at).toLocaleDateString('ko-KR')} 획득)`
            : `${badge.name}: ${badge.description}`
          }
        >
          <div className="text-2xl mb-1">{badge.emoji}</div>
          <div className={`text-xs font-medium ${earned ? 'text-gray-900' : 'text-gray-400'}`}>
            {badge.name}
          </div>
          {earned && (
            <div className="text-xs text-gray-400 mt-0.5">
              {new Date(earned.earned_at).toLocaleDateString('ko-KR')}
            </div>
          )}
        </div>
      )
    })}
  </div>
</div>
```

- [ ] **Step 3: 로컬에서 UI 확인**

Run: `npm run dev`
브라우저에서 `/my` 페이지 확인.
Expected: 프로필 아래에 6개 뱃지 카드가 3x2 그리드로 표시됨. 미획득 뱃지는 흐리게.

- [ ] **Step 4: 커밋**

```bash
git add src/app/my/page.tsx
git commit -m "feat: 마이페이지에 업적 뱃지 카드 그리드 추가"
```

---

### Task 8: 환경변수 및 최종 검증

- [ ] **Step 1: CRON_SECRET 환경변수 설정**

Vercel 대시보드 → claude-code-leaderboard → Settings → Environment Variables:
- `CRON_SECRET` 추가 (랜덤 문자열 생성)

로컬 `.env.local`에도 추가하여 로컬 테스트 가능하게:
```
CRON_SECRET=local-test-secret-for-dev
```

- [ ] **Step 2: 크론 엔드포인트 로컬 테스트**

```bash
curl -H "Authorization: Bearer local-test-secret-for-dev" http://localhost:3000/api/cron/badges
```

Expected: `{ "ok": true, "awarded": N, "details": [...] }` 형태의 응답

- [ ] **Step 3: 전체 플로우 확인**

1. 크론 실행 후 뱃지가 `user_badges` 테이블에 저장되었는지 Supabase 대시보드에서 확인
2. 리더보드 페이지에서 업적 컬럼에 뱃지 이모지가 표시되는지 확인
3. 마이페이지에서 뱃지 카드가 획득/미획득 상태로 표시되는지 확인

- [ ] **Step 4: 최종 커밋 & 푸시**

```bash
git add -A
git commit -m "feat: 환경변수 설정 및 최종 검증 완료"
git push origin main
```
