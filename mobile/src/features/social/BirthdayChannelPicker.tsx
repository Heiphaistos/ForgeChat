// Message d'anniversaire automatique du serveur (lot « Profil et social ») : salon où
// souhaiter l'anniversaire des membres qui ont choisi ce serveur.
import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { socialApi, socialKeys } from '@/api/social'
import { Row } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors } from '@/theme'

export function BirthdayChannelPicker({ serverId }: { serverId: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: socialKeys.serverBirthday(serverId), queryFn: () => socialApi.serverBirthdayChannel(serverId) })
  const channels = useQuery({ queryKey: ['server-channels-text', serverId], queryFn: () => serversApi.channels(serverId), enabled: open })
  const save = useMutation({
    mutationFn: (id: string | null) => socialApi.setServerBirthdayChannel(serverId, id),
    onSuccess: (d) => {
      queryClient.setQueryData(socialKeys.serverBirthday(serverId), d)
      setOpen(false)
    },
    onError: (e) => Alert.alert(t('common.actionFailed'), errorMessage(e)),
  })
  const current = q.data?.channel_id ?? null
  const text = (channels.data ?? []).filter((c) => c.type === 'text')
  const currentName = text.find((c) => c.id === current)?.name
  const check = (on: boolean) => (on ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null)
  return (
    <View>
      <Row
        icon="gift-outline"
        title={t('soc.bday.serverTitle')}
        subtitle={current ? (currentName ? `#${currentName}` : t('soc.bday.serverDesc')) : t('soc.bday.serverOff')}
        onPress={() => setOpen((o) => !o)}
        chevron
      />
      {open ? (
        <>
          <Row title={t('soc.bday.serverOff')} selected={!current} onPress={() => save.mutate(null)} right={check(!current)} />
          {text.map((c) => (
            <Row key={c.id} title={`#${c.name}`} selected={c.id === current} onPress={() => save.mutate(c.id)} right={check(c.id === current)} />
          ))}
        </>
      ) : null}
    </View>
  )
}
