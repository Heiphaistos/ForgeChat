// Fiche profil (lot « Profil et social ») : « en appel », anniversaire (jour et mois,
// jamais l'année) et badges de succès calculés par le serveur (/users/:id/social).
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { intlLocale, useT, type Key } from '../i18n'

export interface UserSocial {
  in_call: boolean
  badges: string[]
  birthday: { month: number; day: number } | null
}

const BADGE_ICONS: Record<string, string> = {
  age_1m: '🌱', age_6m: '🌿', age_1y: '🌳', age_2y: '🏛️', age_3y: '👑',
  msg_100: '💬', msg_1k: '🗣️', msg_10k: '📣', msg_100k: '🏆',
  first_voice: '🎙️', events_1: '📅', events_10: '🎟️',
  friends_1: '🤝', friends_25: '🫂', founder: '🏰',
}

export const isBirthdayToday = (b: { month: number; day: number } | null | undefined, now = new Date()) =>
  !!b && b.month === now.getMonth() + 1 && b.day === now.getDate()

export const dayMonthLabel = (b: { month: number; day: number }) =>
  new Date(2000, b.month - 1, b.day).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long' })

/** `showBadges` : choix de l'utilisateur dans sa carte de profil (users.profile_card.show_badges). */
export default function UserSocialInfo({ userId, showBadges = true }: { userId: string; showBadges?: boolean }) {
  const t = useT()
  const { data } = useQuery<UserSocial>({
    queryKey: ['user-social', userId],
    queryFn: () => api.get(`/users/${userId}/social`).then(r => r.data),
    staleTime: 60_000,
  })
  if (!data) return null
  const known = showBadges ? data.badges.filter(b => b in BADGE_ICONS) : []
  if (!data.in_call && !data.birthday && known.length === 0) return null
  return (
    <div className="mb-3 space-y-2">
      {data.in_call && <div className="text-sm text-fc-green">📞 {t('soc.inCall')}</div>}
      {data.birthday && (
        <div className={`text-sm ${isBirthdayToday(data.birthday) ? 'text-fc-yellow font-medium' : 'text-fc-text'}`}>
          🎂 {isBirthdayToday(data.birthday) ? t('soc.bday.today') : dayMonthLabel(data.birthday)}
        </div>
      )}
      {known.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t('soc.badges.title')}</div>
          <ul className="flex flex-wrap gap-1">
            {known.map(b => (
              <li key={b} title={t(`soc.badge.${b}` as Key)} aria-label={t(`soc.badge.${b}` as Key)}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-fc-channel text-base">
                <span aria-hidden>{BADGE_ICONS[b]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
