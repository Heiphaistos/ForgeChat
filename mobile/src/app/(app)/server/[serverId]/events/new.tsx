import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { eventsApi } from '@/api/events'
import { Button, ErrorState, Section, T, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { EVENT_TYPES, defaultEventFields, parseLocalDateTime } from '@/features/servers/events'
import { useServerDetail } from '@/features/servers/menus'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const DURATIONS = [0, 30, 60, 120, 240]
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const
const REMINDERS = [0, 5, 15, 30, 60, 1440]

/** Créer un événement (tout membre non exclu ; début dans le futur). */
export default function NewEventScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const detail = useServerDetail(sid, valid)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('event')
  const [{ day, time }, setWhen] = useState(defaultEventFields)
  const [duration, setDuration] = useState(60)
  const [channelId, setChannelId] = useState<string | null>(null)
  const [max, setMax] = useState('')
  const [recurrence, setRecurrence] = useState<string>('none')
  const [reminder, setReminder] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!valid) return <ErrorState message={t('server.invalid')} />

  const save = async () => {
    const start = parseLocalDateTime(day, time)
    const maxN = max.trim() ? Number(max) : undefined
    if (!name.trim()) return setError(t('server.eventNew.nameRequired'))
    if (!start) return setError(t('server.eventNew.badDate'))
    if (start.getTime() <= Date.now()) return setError(t('server.eventNew.pastDate'))
    if (maxN !== undefined && !(Number.isInteger(maxN) && maxN > 0)) return setError(t('server.eventNew.badMax'))
    setSaving(true)
    setError(null)
    try {
      await eventsApi.create(sid, {
        name: name.trim(),
        description: description.trim() || undefined,
        event_type: type,
        start_time: start.toISOString(),
        end_time: duration ? new Date(start.getTime() + duration * 60_000).toISOString() : undefined,
        channel_id: channelId ?? undefined,
        max_attendees: maxN,
        recurrence,
        reminder_minutes: reminder || undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ['events', sid] })
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const channels = detail.data?.channels ?? []
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('server.eventNew.title') }} />
      <TextField label={t('server.eventNew.name')} value={name} onChangeText={setName} maxLength={100} placeholder={t('server.eventNew.namePlaceholder')} />
      <TextField label={t('server.eventNew.description')} value={description} onChangeText={setDescription} multiline maxLength={1000} style={{ minHeight: 80, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 3 }}>
          <TextField label={t('server.eventNew.date')} value={day} onChangeText={(v) => setWhen((w) => ({ ...w, day: v }))} placeholder={t('server.eventNew.datePlaceholder')} keyboardType="numbers-and-punctuation" maxLength={10} />
        </View>
        <View style={{ flex: 2 }}>
          <TextField label={t('server.eventNew.time')} value={time} onChangeText={(v) => setWhen((w) => ({ ...w, time: v }))} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
      </View>
      <Section>
        <ChoiceRow icon="pricetag-outline" title={t('server.eventNew.type')} value={type} options={EVENT_TYPES.map((et) => ({ value: et.value, label: t(et.label) }))} onChange={setType} />
        <ChoiceRow icon="hourglass-outline" title={t('server.eventNew.duration')} value={duration} options={DURATIONS.map((m) => ({ value: m, label: m === 0 ? t('server.eventNew.noDuration') : m < 60 ? `${m} min` : `${m / 60} h` }))} onChange={setDuration} />
        <ChoiceRow
          icon="chatbubble-outline"
          title={t('server.eventNew.channel')}
          value={channelId}
          options={[{ value: null, label: t('server.eventNew.noChannel') }, ...channels.map((c) => ({ value: c.id as string | null, label: c.name }))]}
          onChange={setChannelId}
        />
        <ChoiceRow icon="repeat-outline" title={t('community.events.repeat')} value={recurrence}
          options={RECURRENCES.map((r) => ({ value: r as string, label: t(`community.events.r.${r}`) }))} onChange={setRecurrence} />
        <ChoiceRow icon="alarm-outline" title={t('community.events.reminder')} value={reminder}
          options={REMINDERS.map((m) => ({ value: m, label: m === 0 ? t('community.events.noReminder') : m >= 60 ? t('community.events.hoursBefore', { n: m / 60 }) : t('community.events.minutesBefore', { n: m }) }))}
          onChange={setReminder} />
      </Section>
      <TextField label={t('server.eventNew.max')} value={max} onChangeText={setMax} keyboardType="number-pad" maxLength={5} placeholder={t('server.eventNew.maxPlaceholder')} />
      {error ? <T variant="error">{error}</T> : null}
      <Button title={t('server.eventNew.submit')} onPress={save} loading={saving} />
    </ScrollView>
  )
}
