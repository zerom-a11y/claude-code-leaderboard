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
