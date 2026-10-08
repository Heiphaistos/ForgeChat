// Messages éphémères d'une conversation : bouton d'en-tête (minuteur) qui indique le réglage
// et permet de le changer (MP, groupe : tout membre ; salon : droit de modifier les salons).
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { messagingApi } from '@/api/messaging'
import { Sheet } from '@/components/Sheet'
import { IconButton } from '@/components/ui'
import { serversApi } from '@/api/servers'
import { useServerPerms } from '@/features/servers/menus'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { disappearingKey } from '@/services/messagingBindings'
import { colors, font } from '@/theme'
import { disappearChoice, disappearChoices } from './messaging'

type Props = { kind: 'dm' | 'group'; id: string; serverId?: undefined } | { kind: 'channel'; id: string; serverId: string }

export type DisappearingProps = Props

/** Réglage éphémère d'une conversation : libellé, état, feuille de choix (bouton ou menu ⋮). */
export function useDisappearing(props: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const isChannel = props.kind === 'channel'
  const serverId = props.serverId ?? ''
  const priv = useQuery({
    queryKey: disappearingKey(isChannel ? 'dm' : (props.kind as 'dm' | 'group'), props.id),
    queryFn: () => messagingApi.disappearing(props.kind as 'dm' | 'group', props.id),
    enabled: !isChannel,
    staleTime: 5 * 60_000,
  })
  // Même requête que useChannelInfo (servers/ChannelChat) : partagée par le cache.
  const channels = useQuery({ queryKey: qk.channels(serverId), queryFn: () => serversApi.channels(serverId), enabled: isChannel })
  const channel = channels.data?.find((c) => c.id === props.id)
  const canEditChannels = useServerPerms(serverId, isChannel).canEditChannels
  const value = isChannel ? (channel?.disappear_seconds ?? null) : (priv.data ?? null)
  const canEdit = !isChannel || canEditChannels
  const choice = disappearChoice(value)
  const label = value === null ? t('messaging.disappear.title') : t('messaging.disappear.active', { d: t(choice.label) })

  const save = (seconds: number | null) => {
    const done = isChannel
      ? messagingApi.setChannelMessaging(serverId, props.id, { disappear_seconds: seconds })
          .then(() => queryClient.invalidateQueries({ queryKey: qk.channels(serverId) }))
      : messagingApi.setDisappearing(props.kind as 'dm' | 'group', props.id, seconds)
          .then(() => queryClient.setQueryData(disappearingKey(props.kind as 'dm' | 'group', props.id), seconds))
    done.catch((e) => Alert.alert(t('messaging.disappear.failed'), errorMessage(e)))
  }

  const sheet = (
    <Sheet
      visible={open}
      onClose={() => setOpen(false)}
      title={t('messaging.disappear.title')}
      header={<Text style={{ color: colors.textMuted, fontSize: font.sm, paddingHorizontal: 16, paddingBottom: 8 }}>
        {t('messaging.disappear.hint')}{isChannel ? '' : `
${t('messaging.disappear.afterReadHint')}`}
      </Text>}
      actions={disappearChoices(props.kind).map((c) => ({
        label: t(c.label),
        icon: 'timer-outline',
        selected: c.value === value,
        onPress: () => {
          setOpen(false)
          save(c.value)
        },
      }))}
    />
  )
  return {
    /** Rien à montrer : réglage inactif et pas le droit de le changer. */
    hidden: !canEdit && value === null,
    active: value !== null,
    label,
    short: choice.short,
    open: () => (canEdit ? setOpen(true) : Alert.alert(t('messaging.disappear.title'), label)),
    sheet,
  }
}

/** Indicateur d'en-tête (minuteur + durée courte), affiché quand le réglage est actif. */
export function DisappearingIndicator({ d }: { d: ReturnType<typeof useDisappearing> }) {
  const t = useT()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <IconButton icon="timer-outline" label={d.label} active={d.active} color={d.active ? colors.primary : undefined} onPress={d.open} />
      {d.short ? (
        <Text style={{ color: colors.primary, fontSize: font.xs, fontWeight: '700', marginLeft: -6 }} accessibilityElementsHidden importantForAccessibility="no">
          {t(d.short)}
        </Text>
      ) : null}
    </View>
  )
}
