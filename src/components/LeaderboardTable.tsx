'use client'

type Entry = {
  rank: number
  user_id: string
  nickname: string
  department: string
  total_tokens: number
  all_time_tokens: number
  buddy?: boolean
  bio?: string
  isMe?: boolean
  five_hour_pct?: number | null
  seven_day_pct?: number | null
  seven_day_resets_at?: string | null
  hit_100_count?: number
}

const BADGE_TIERS = [
  { threshold: 10_000_000_000, emoji: '👑' }, // 레전드
  { threshold:  1_000_000_000, emoji: '💎' }, // 마스터
  { threshold:    500_000_000, emoji: '⚔️' }, // 히어로
  { threshold:    100_000_000, emoji: '🔥' }, // 파워유저
  { threshold:     10_000_000, emoji: '⚡' }, // 러너
  { threshold:              0, emoji: '🌱' }, // 새싹
]

function getBadge(allTimeTokens: number): string {
  return BADGE_TIERS.find(t => allTimeTokens >= t.threshold)?.emoji ?? '🌱'
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

function pctColor(pct: number | null | undefined): string {
  if (pct == null) return 'text-gray-600'
  if (pct >= 90) return 'text-red-400'
  if (pct >= 70) return 'text-yellow-400'
  return 'text-green-400'
}

function formatResetDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = d.getHours().toString().padStart(2, '0')
  const mins = d.getMinutes().toString().padStart(2, '0')
  return `${month}/${day} ${hours}:${mins}`
}

export default function LeaderboardTable({ data, loading }: { data: Entry[]; loading: boolean }) {
  if (loading) {
    return <div className="text-center py-12 text-gray-500">불러오는 중...</div>
  }

  if (data.length === 0) {
    return <div className="text-center py-12 text-gray-500">아직 데이터가 없습니다.</div>
  }

  // rate limit 데이터가 하나라도 있는지 확인
  const hasRateLimit = data.some(e => e.five_hour_pct != null || e.seven_day_pct != null)

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400 text-sm">
            <th className="py-3 px-4 text-left w-12">#</th>
            <th className="py-3 px-4 text-left">닉네임</th>
            <th className="py-3 pl-0 pr-4 text-left whitespace-nowrap">부서</th>
            <th className="py-3 px-4 text-right whitespace-nowrap">사용량</th>
            {hasRateLimit && (
              <>
                <th className="py-3 px-2 text-right whitespace-nowrap" title="5시간 세션 사용률 (최신)">5h</th>
                <th className="py-3 px-2 text-right whitespace-nowrap" title="7일 주간 사용량 비율 (최신)">7d</th>
                <th className="py-3 px-2 text-right whitespace-nowrap" title="7일 주간 사용량 리셋 예정 일시">reset</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map(entry => (
            <tr key={entry.user_id}
              className={`border-b border-gray-800/50 ${entry.isMe ? 'bg-blue-500/10' : 'hover:bg-gray-800/50'}`}>
              <td className="py-3 px-4 font-mono text-gray-400">
                {entry.rank <= 3 ? ['\u{1F947}', '\u{1F948}', '\u{1F949}'][entry.rank - 1] : entry.rank}
              </td>
              <td className="py-3 px-4 font-medium">
                <span className="mr-1">{getBadge(entry.all_time_tokens)}</span>
                {entry.nickname}
                {entry.isMe && <span className="text-blue-400 text-xs ml-1">나</span>}
                {entry.bio && <span className="ml-5 text-sm text-gray-400 font-normal">{entry.bio}</span>}
              </td>
              <td className="py-3 pl-0 pr-4 text-gray-400 whitespace-nowrap">{entry.department}</td>
              <td className="py-3 px-4 text-right font-mono">{formatTokens(entry.total_tokens)}</td>
              {hasRateLimit && (
                <>
                  <td className={`py-3 px-2 text-right font-mono text-sm ${pctColor(entry.five_hour_pct)}`}>
                    {entry.five_hour_pct != null ? `${Math.round(entry.five_hour_pct)}%` : '-'}
                  </td>
                  <td className={`py-3 px-2 text-right font-mono text-sm ${pctColor(entry.seven_day_pct)}`}>
                    {entry.seven_day_pct != null ? `${Math.round(entry.seven_day_pct)}%` : '-'}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-xs text-gray-500">
                    {formatResetDate(entry.seven_day_resets_at)}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
