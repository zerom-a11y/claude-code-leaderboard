import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import type { BadgeKey } from '@/lib/badges'

const PAGE_SIZE = 1000

async function fetchAllSessionsForBadges(client: any) {
  const rows: { user_id: string; total_tokens: number; created_at: string }[] = []
  let from = 0
  while (true) {
    const { data, error } = await client
      .from('sessions')
      .select('user_id, total_tokens, created_at')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

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

  // 전체 세션 조회 (페이지네이션)
  const allSessions = await fetchAllSessionsForBadges(supabase)

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
