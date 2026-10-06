import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { eventsApi } from '@/api/events'
import { Button, ErrorState, Section, T, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { EVENT_TYPES, defaultEventFields, parseLocalDateTime } from '@/features/servers/events'
import { useServerDetail } from '@/features/servers/menus'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const DURATIONS = [0, 30, 60, 120, 240].map((m) => ({ value: m, label: m === 0 ? 'Non précisée' : m < 60 ? `${m} min` : `${m / 60} h` }))

/** Créer un événement (tout membre non exclu ; début dans le futur). */
export default function NewEventScreen() {
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!valid) return <ErrorState message="Serveur invalide." />

  const save = async () => {
    const start = parseLocalDateTime(day, time)
    const maxN = max.trim() ? Number(max) : undefined
    if (!name.trim()) return setError('Donne un nom à l’événement.')
    if (!start) return setError('Date ou heure invalide (JJ/MM/AAAA et HH:MM).')
    if (start.getTime() <= Date.now()) return setError('La date de début doit être dans le futur.')
    if (maxN !== undefined && !(Number.isInteger(maxN) && maxN > 0)) return setError('Nombre de places : un entier positif.')
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
      <Stack.Screen options={{ title: 'Nouvel événement' }} />
      <TextField label="Nom" value={name} onChangeText={setName} maxLength={100} placeholder="Soirée jeux" />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={1000} style={{ minHeight: 80, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 3 }}>
          <TextField label="Date" value={day} onChangeText={(v) => setWhen((w) => ({ ...w, day: v }))} placeholder="JJ/MM/AAAA" keyboardType="numbers-and-punctuation" maxLength={10} />
        </View>
        <View style={{ flex: 2 }}>
          <TextField label="Heure" value={time} onChangeText={(v) => setWhen((w) => ({ ...w, time: v }))} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
      </View>
      <Section>
        <ChoiceRow icon="pricetag-outline" title="Type" value={type} options={EVENT_TYPES} onChange={setType} />
        <ChoiceRow icon="hourglass-outline" title="Durée" value={duration} options={DURATIONS} onChange={setDuration} />
        <ChoiceRow
          icon="chatbubble-outline"
          title="Salon"
          value={channelId}
          options={[{ value: null, label: 'Aucun' }, ...channels.map((c) => ({ value: c.id as string | null, label: c.name }))]}
          onChange={setChannelId}
        />
      </Section>
      <TextField label="Places (facultatif)" value={max} onChangeText={setMax} keyboardType="number-pad" maxLength={5} placeholder="Illimité" />
      {error ? <T variant="error">{error}</T> : null}
      <Button title="Créer l’événement" onPress={save} loading={saving} />
    </ScrollView>
  )
}
