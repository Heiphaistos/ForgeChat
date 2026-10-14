import { Linking, Share, View } from 'react-native'
import type { ServerEvent } from '@/api/events'
import { Button, T } from '@/components/ui'
import { formatEventDate } from '@/features/servers/events'
import { useT } from '@/i18n'
import { spacing } from '@/theme'
import { googleCalendarUrl } from './format'

/** Répétition, rappel et « ajouter à mon agenda » (lien Google Agenda, ou partage). */
export function EventExtras({ event: e }: { event: ServerEvent }) {
  const t = useT()
  const repeat = e.recurrence && e.recurrence !== 'none' ? t(`community.events.r.${e.recurrence as 'daily' | 'weekly' | 'monthly'}`) : null
  const reminder = e.reminder_minutes
    ? e.reminder_minutes >= 60 ? t('community.events.hoursBefore', { n: e.reminder_minutes / 60 }) : t('community.events.minutesBefore', { n: e.reminder_minutes })
    : null
  const url = googleCalendarUrl(e)
  return (
    <View style={{ gap: spacing.sm }}>
      {repeat || reminder ? <T variant="muted">{[repeat, reminder && `🔔 ${reminder}`].filter(Boolean).join(' · ')}</T> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={t('community.events.google')} icon="calendar-outline" variant="secondary" style={{ flex: 1 }}
          onPress={() => void Linking.openURL(url).catch(() => undefined)} />
        <Button title={t('community.events.share')} icon="share-outline" variant="secondary" style={{ flex: 1 }}
          onPress={() => void Share.share({ message: `${e.name}\n${formatEventDate(e.start_time)}${repeat ? ` (${repeat})` : ''}\n${url}` })} />
      </View>
    </View>
  )
}
