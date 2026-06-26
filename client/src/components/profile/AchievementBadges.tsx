import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'

interface Achievement {
  id: string
  key: string
  label: string
  description: string
  icon: string
  earned_at?: string
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
}

interface AchievementBadgesProps {
  userId: string
  joinedAt?: string
}

const RARITY_STYLES: Record<Achievement['rarity'], { border: string; bg: string; label: string; glow: string }> = {
  common:    { border: 'border-gray-500/50',  bg: 'bg-gray-500/10',  label: 'text-gray-400',   glow: '' },
  rare:      { border: 'border-blue-500/60',  bg: 'bg-blue-500/10',  label: 'text-blue-400',   glow: 'shadow-blue-500/20' },
  epic:      { border: 'border-purple-500/60',bg: 'bg-purple-500/10',label: 'text-purple-400', glow: 'shadow-purple-500/20' },
  legendary: { border: 'border-amber-500/70', bg: 'bg-amber-500/10', label: 'text-amber-400',  glow: 'shadow-amber-500/30' },
}

const EARLY_ADOPTER: Achievement = {
  id: 'early_adopter',
  key: 'early_adopter',
  label: 'Early Adopter',
  description: 'A rejoint ForgeChat dans ses premiers jours.',
  icon: '🌟',
  rarity: 'legendary',
}

function BadgeTooltip({ achievement, onClose }: { achievement: Achievement; onClose: () => void }) {
  const s = RARITY_STYLES[achievement.rarity]
  return (
    <div
      className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg border p-3 z-50 shadow-lg ${s.border} ${s.bg} bg-fc-bg backdrop-blur`}
      style={{ boxShadow: s.glow ? `0 0 12px var(--tw-shadow-color)` : undefined }}
    >
      <button
        onClick={onClose}
        className="absolute top-1.5 right-1.5 text-fc-muted hover:text-white text-xs leading-none"
      >
        ✕
      </button>
      <div className="text-2xl mb-1">{achievement.icon}</div>
      <div className={`text-xs font-bold mb-0.5 ${s.label}`}>{achievement.label}</div>
      <div className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${s.label} opacity-70`}>
        {achievement.rarity}
      </div>
      <div className="text-xs text-fc-muted leading-snug">{achievement.description}</div>
      {achievement.earned_at && (
        <div className="text-[10px] text-fc-muted mt-1.5 opacity-60">
          Obtenu le {new Date(achievement.earned_at).toLocaleDateString('fr-FR')}
        </div>
      )}
    </div>
  )
}

export default function AchievementBadges({ userId, joinedAt }: AchievementBadgesProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: achievements = [], isError } = useQuery<Achievement[]>({
    queryKey: ['achievements', userId],
    queryFn: () => api.get(`/users/${userId}/achievements`).then(r => r.data),
    enabled: !!userId,
    staleTime: 300_000,
    retry: false,
  })

  // Fallback Early Adopter si 404 ou liste vide + joined < 30 jours
  const displayBadges: Achievement[] = (() => {
    if (!isError && achievements.length > 0) return achievements
    const fallback: Achievement[] = []
    if (joinedAt) {
      const joined = new Date(joinedAt).getTime()
      const now = Date.now()
      const diffDays = (now - joined) / (1000 * 60 * 60 * 24)
      if (diffDays < 30) fallback.push(EARLY_ADOPTER)
    }
    return fallback
  })()

  if (displayBadges.length === 0) return null

  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
        Badges
      </div>
      <div className="flex flex-wrap gap-1.5">
        {displayBadges.map((badge) => {
          const s = RARITY_STYLES[badge.rarity]
          const isOpen = expanded === badge.id
          return (
            <div key={badge.id} className="relative">
              <button
                onClick={() => setExpanded(isOpen ? null : badge.id)}
                className={`
                  w-9 h-9 rounded-lg border text-lg flex items-center justify-center transition
                  hover:scale-110 hover:shadow-md
                  ${s.border} ${s.bg}
                  ${isOpen ? 'scale-110 ring-1 ring-offset-1 ring-offset-fc-bg ring-fc-accent' : ''}
                `}
                title={badge.label}
              >
                {badge.icon}
              </button>
              {isOpen && (
                <BadgeTooltip achievement={badge} onClose={() => setExpanded(null)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
