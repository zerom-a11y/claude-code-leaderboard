import { createClient, createServiceClient } from '@/lib/supabase-server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || 'all'
  const role = searchParams.get('role') || 'all'

  const validPeriods = ['daily', 'weekly', 'all']
  const validRoles = ['all', 'developer', 'non-developer']
  if (!validPeriods.includes(period) || !validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }

  // 기간 필터 계산 (KST 기준)
  let sinceDate: string | null = null
  const now = new Date()
  const kstOffset = 9 * 60 * 60 * 1000
  const kstNow = new Date(now.getTime() + kstOffset)
  const kstToday = kstNow.toISOString().split('T')[0]

  if (period === 'daily') {
    sinceDate = new Date(`${kstToday}T00:00:00+09:00`).toISOString()
  } else if (period === 'weekly') {
    const kstDay = kstNow.getUTCDay()
    const daysSinceMonday = (kstDay + 6) % 7
    const monday = new Date(kstNow.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000)
    const mondayDate = monday.toISOString().split('T')[0]
    sinceDate = new Date(`${mondayDate}T00:00:00+09:00`).toISOString()
  }

  const serviceClient = createServiceClient()

  try {
    // 1. RPC로 서버사이드 집계 (기간별 + 누적 토큰 한번에)
    const { data: leaderboard, error: rpcError } = await serviceClient
      .rpc('get_leaderboard', { since_date: sinceDate, role_filter: role })
    if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 })
    if (!leaderboard || leaderboard.length === 0) {
      return NextResponse.json({ data: [] }, {
        headers: { 'Cache-Control': 'private, max-age=30' },
      })
    }

    const userIds = leaderboard.map((r: any) => r.user_id)

    // 2. 뱃지 + rate limit 병렬 조회
    const badgesPromise = serviceClient
      .from('user_badges')
      .select('user_id, badge_key')
      .in('user_id', userIds)

    // 현재 유저의 api_token 조회 (메인 페이지에서 /api/me 호출 제거용)
    const tokenPromise = serviceClient
      .from('users')
      .select('api_token')
      .eq('id', user.id)
      .single()

    // rate limit 쿼리 (누적 탭에서는 스킵)
    const snapshotsPromise = period !== 'all'
      ? serviceClient
          .from('rate_limit_snapshots')
          .select('user_id, five_hour_pct, seven_day_pct, seven_day_resets_at')
          .in('user_id', userIds)
          .order('created_at', { ascending: false })
      : null
    const hitCountPromise = period !== 'all'
      ? serviceClient
          .from('rate_limit_snapshots')
          .select('user_id, five_hour_resets_at')
          .in('user_id', userIds)
          .gte('five_hour_pct', 100)
          .not('five_hour_resets_at', 'is', null)
      : null

    // 뱃지 + 토큰 + rate limit 모두 병렬 실행
    const [badgesResult, tokenResult, snapshotsResult, hitCountResult] = await Promise.all([
      badgesPromise,
      tokenPromise,
      snapshotsPromise,
      hitCountPromise,
    ])

    // 뱃지 매핑
    const userBadgesMap = new Map<string, string[]>()
    for (const b of badgesResult.data || []) {
      const list = userBadgesMap.get(b.user_id) || []
      list.push(b.badge_key)
      userBadgesMap.set(b.user_id, list)
    }

    // rate limit 매핑
    const rateLimitMap = new Map<string, { five_hour_pct: number; seven_day_pct: number; seven_day_resets_at: string | null; hit_100_count: number }>()
    if (snapshotsResult?.data) {
      const seen = new Set<string>()
      for (const s of snapshotsResult.data) {
        if (!seen.has(s.user_id)) {
          seen.add(s.user_id)
          rateLimitMap.set(s.user_id, {
            five_hour_pct: Number(s.five_hour_pct) || 0,
            seven_day_pct: Number(s.seven_day_pct) || 0,
            seven_day_resets_at: s.seven_day_resets_at,
            hit_100_count: 0,
          })
        }
      }
    }
    if (hitCountResult?.data) {
      const countMap = new Map<string, Set<string>>()
      for (const s of hitCountResult.data) {
        if (!countMap.has(s.user_id)) countMap.set(s.user_id, new Set())
        countMap.get(s.user_id)!.add(s.five_hour_resets_at)
      }
      for (const [uid, resetTimes] of countMap) {
        const existing = rateLimitMap.get(uid)
        if (existing) existing.hit_100_count = resetTimes.size
      }
    }

    const apiToken = tokenResult?.data?.api_token || ''

    // 결과 조합
    const result = leaderboard.map((row: any, i: number) => {
      const rl = rateLimitMap.get(row.user_id)
      return {
        rank: i + 1,
        user_id: row.user_id,
        nickname: row.nickname,
        department: row.department,
        role: row.role,
        buddy: row.buddy ?? false,
        bio: row.bio || '',
        total_tokens: row.total_tokens,
        all_time_tokens: row.all_time_tokens,
        badges: userBadgesMap.get(row.user_id) || [],
        isMe: row.user_id === user.id,
        five_hour_pct: rl?.five_hour_pct ?? null,
        seven_day_pct: rl?.seven_day_pct ?? null,
        seven_day_resets_at: rl?.seven_day_resets_at ?? null,
        hit_100_count: rl?.hit_100_count ?? 0,
      }
    })

    return NextResponse.json({ data: result, api_token: apiToken }, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
