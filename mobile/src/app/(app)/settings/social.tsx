// Musique en cours et anniversaire (lot « Profil et social »).
import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { socialApi, socialKeys, type BirthdayPatch, type BirthdayVisibility, type MyBirthday } from '@/api/social'
import { usersApi } from '@/api/users'
import { Button, ErrorState, Loading, Row, Section, TextField } from '@/components/ui'
import { validBirthday } from '@/features/social/birthday'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

const VISIBILITY: { v: BirthdayVisibility; label: Key }[] = [
  { v: 'nobody', label: 'soc.bday.nobody' },
  { v: 'friends', label: 'soc.bday.friends' },
  { v: 'servers', label: 'soc.bday.servers' },
]

function MusicSection() {
  const t = useT()
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const listening = user?.activity_type === 'listening' ? (user.activity_name ?? '') : ''
  const [text, setText] = useState(listening)
  const save = useMutation({
    mutationFn: (v: string) => usersApi.updateMe(v ? { activity_type: 'listening', activity_name: v } : { activity_type: '' }),
    onSuccess: (u) => setUser(u),
    onError: (e) => Alert.alert(t('soc.groups.error'), errorMessage(e)),
  })
  return (
    <Section title={`🎵 ${t('soc.music.title')}`} footer={t('soc.music.hint')}>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <TextField value={text} onChangeText={setText} placeholder={t('soc.music.ph')} maxLength={100} accessibilityLabel={t('soc.music.title')} />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('soc.music.set')} disabled={!text.trim()} loading={save.isPending} onPress={() => save.mutate(text.trim())} style={{ flex: 1 }} />
          {listening ? (
            <Button
              title={t('soc.music.clear')}
              variant="secondary"
              onPress={() => {
                setText('')
                save.mutate('')
              }}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      </View>
    </Section>
  )
}

function BirthdaySection({ data }: { data: MyBirthday }) {
  const t = useT()
  const servers = useQuery({ queryKey: qk.servers, queryFn: serversApi.list })
  // Valeurs initiales seulement : après un enregistrement, la saisie est déjà à jour.
  const [day, setDay] = useState(data.birthday ? String(data.birthday.day) : '')
  const [month, setMonth] = useState(data.birthday ? String(data.birthday.month) : '')
  const [year, setYear] = useState(data.birthday?.year ? String(data.birthday.year) : '')
  const save = useMutation({
    mutationFn: (patch: BirthdayPatch) => socialApi.setMyBirthday(patch),
    onSuccess: (d) => queryClient.setQueryData(socialKeys.birthday, d),
    onError: (e) => Alert.alert(t('soc.groups.error'), errorMessage(e)),
  })
  const saveDate = () => {
    const y = year.trim() ? Number(year) : null
    if (!day.trim() && !month.trim()) return save.mutate({ birthday: null }, { onSuccess: () => Alert.alert(t('soc.bday.saved')) })
    const d = Number(day)
    const m = Number(month)
    if (!validBirthday(m, d, y)) return Alert.alert(t('soc.bday.invalid'))
    save.mutate({ birthday: { month: m, day: d, year: y } }, { onSuccess: () => Alert.alert(t('soc.bday.saved')) })
  }
  const chosen = new Set(data.server_ids)

  return (
    <>
      <Section title={`🎂 ${t('soc.bday.title')}`}>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField label={t('soc.bday.day')} placeholder={t('soc.bday.dayPh')} value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label={t('soc.bday.month')} placeholder={t('soc.bday.monthPh')} value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} />
            </View>
          </View>
          <TextField label={t('soc.bday.year')} placeholder={t('soc.bday.yearPh')} value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
          <Button title={t('soc.bday.save')} loading={save.isPending} onPress={saveDate} />
        </View>
      </Section>
      <Section title={t('soc.bday.visibility')}>
        {VISIBILITY.map((o) => (
          <Row
            key={o.v}
            title={t(o.label)}
            selected={data.visibility === o.v}
            onPress={() => save.mutate({ visibility: o.v })}
            right={data.visibility === o.v ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>
      {data.visibility === 'servers' ? (
        <Section title={t('soc.bday.pick')}>
          {(servers.data ?? []).map((s) => (
            <Row
              key={s.id}
              title={s.name}
              selected={chosen.has(s.id)}
              onPress={() => save.mutate({ server_ids: chosen.has(s.id) ? data.server_ids.filter((id) => id !== s.id) : [...data.server_ids, s.id] })}
              right={chosen.has(s.id) ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
            />
          ))}
        </Section>
      ) : null}
    </>
  )
}

export default function SocialSettingsScreen() {
  const t = useT()
  const q = useQuery({ queryKey: socialKeys.birthday, queryFn: socialApi.myBirthday })
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('soc.settings.title') }} />
      <MusicSection />
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : <BirthdaySection data={q.data} />}
    </ScrollView>
  )
}
