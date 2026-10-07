// Événements temps réel du lot communauté : rappel d'événement, niveau franchi, verrouillage.
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useWs } from '../../store/ws'
import { intlLocale, t } from '../../i18n'

export function useCommunityRealtime(userId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!userId) return
    const { on } = useWs.getState()
    const offs = [
      on('EVENT_REMINDER', (d: any) => {
        const at = new Date(d.start_time).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
        toast(t('community.events.remind', { name: String(d.name ?? ''), at }), { icon: '📅', duration: 12000 })
      }),
      on('LEVEL_UP', (d: any) => {
        toast.success(t('community.levels.up', { n: Number(d.level) }), { icon: '🏆', duration: 6000 })
        if (d.server_id) qc.invalidateQueries({ queryKey: ['levels_board', d.server_id] })
      }),
      on('SERVER_LOCKDOWN', (d: any) => {
        if (!d.server_id) return
        qc.invalidateQueries({ queryKey: ['server', d.server_id] })
        qc.invalidateQueries({ queryKey: ['community', d.server_id] })
        if (d.lockdown) toast(t(d.reason === 'raid' ? 'community.lockdown.raidToast' : 'community.lockdown.banner'), { icon: '🛡️', duration: 8000 })
      }),
    ]
    return () => offs.forEach(off => off())
  }, [userId, qc])
}
