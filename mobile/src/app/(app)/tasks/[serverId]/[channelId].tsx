import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { tasksApi } from '@/api/tasks'
import { Button, ErrorState, IconButton, Loading, Row, Section, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { PRIORITIES, canEditTask, createTaskBody, dueState, type ChannelTask, type TaskPriority } from '@/features/tasks/tasks'
import { useT } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'

/** Tâches du salon (kanban à deux colonnes : à faire / terminées), comme components/tasks/KanbanBoard du web. */
export default function ChannelTasksScreen() {
  const { valid, ids } = useRouteParams(['serverId', 'channelId'] as const)
  const sid = ids.serverId ?? ''
  const cid = ids.channelId ?? ''
  const t = useT()
  const qc = useQueryClient()
  const meId = useAuth((s) => s.user?.id)
  const perms = useServerPerms(sid, valid)
  const q = useQuery({ queryKey: qk.tasks(cid), queryFn: () => tasksApi.list(cid), enabled: valid })
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const refresh = () => qc.invalidateQueries({ queryKey: qk.tasks(cid) })
  const fail = (e: unknown) => Alert.alert(t('tasks.failed'), errorMessage(e))
  const create = useMutation({
    mutationFn: (b: NonNullable<ReturnType<typeof createTaskBody>>) => tasksApi.create(cid, b),
    onSuccess: () => {
      setTitle('')
      setDesc('')
      void refresh()
    },
    onError: fail,
  })
  const toggle = useMutation({ mutationFn: (x: ChannelTask) => tasksApi.setCompleted(cid, x.id, !x.completed), onSuccess: refresh, onError: fail })
  const remove = useMutation({ mutationFn: (id: string) => tasksApi.remove(cid, id), onSuccess: refresh, onError: fail })

  if (!valid) return <ErrorState message={t('conv.invalidChannel')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const isMod = perms.has(PERM.MANAGE_MESSAGES)
  const body = createTaskBody(title, desc, priority)
  const confirmDelete = (x: ChannelTask) =>
    Alert.alert(t('tasks.deleteTitle', { name: x.title }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate(x.id) },
    ])
  const list = (done: boolean) => {
    const items = (q.data ?? []).filter((x) => x.completed === done)
    return (
      <Section title={`${t(done ? 'tasks.done' : 'tasks.todo')} (${items.length})`}>
        {items.length ? null : <Row title={t('tasks.empty')} />}
        {items.map((x) => {
          const can = canEditTask(x, meId, isMod)
          const due = dueState(x.dueDate)
          return (
            <Row
              key={x.id}
              icon={done ? 'checkmark-circle' : 'ellipse-outline'}
              title={x.title}
              subtitle={[t(`tasks.prio.${x.priority}`), x.dueDate ? `${due === 'late' ? t('tasks.late') + ' ' : ''}${formatShort(x.dueDate)}` : null, x.description].filter(Boolean).join(' · ')}
              onPress={can ? () => toggle.mutate(x) : undefined}
              right={can ? <IconButton icon="trash-outline" label={t('tasks.deleteLabel', { name: x.title })} color={colors.danger} onPress={() => confirmDelete(x)} /> : undefined}
            />
          )
        })}
      </Section>
    )
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('tasks.title') }} />
      <Section title={t('tasks.add')}>
        <TextField value={title} onChangeText={setTitle} placeholder={t('tasks.titlePh')} accessibilityLabel={t('tasks.titlePh')} maxLength={200} style={{ borderRadius: 0 }} />
        <TextField value={desc} onChangeText={setDesc} placeholder={t('tasks.descPh')} accessibilityLabel={t('tasks.descPh')} maxLength={1000} multiline style={{ borderRadius: 0 }} />
        <ChoiceRow icon="flag-outline" title={t('tasks.priority')} value={priority} options={PRIORITIES.map((p) => ({ value: p, label: t(`tasks.prio.${p}`) }))} onChange={setPriority} />
      </Section>
      <Button title={t('tasks.create')} icon="add" disabled={!body} loading={create.isPending} onPress={() => body && create.mutate(body)} style={{ marginBottom: spacing.xl }} />
      {list(false)}
      {list(true)}
    </ScrollView>
  )
}
