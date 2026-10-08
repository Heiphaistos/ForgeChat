// Bouton ⋮ d'en-tête de conversation : regroupe les actions secondaires (épinglés, recherche,
// support, éphémères…) pour que la barre ne recouvre jamais le nom sur un écran étroit.
import { useState } from 'react'
import { View } from 'react-native'
import { Sheet, type SheetAction } from '@/components/Sheet'
import { IconButton } from '@/components/ui'
import { useT } from '@/i18n'
import { DisappearingIndicator, useDisappearing, type DisappearingProps } from './DisappearingButton'

export function HeaderMenu({ title, actions, disappearing }: { title?: string; actions: SheetAction[]; disappearing: DisappearingProps }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const d = useDisappearing(disappearing)
  const all: SheetAction[] = d.hidden ? actions : [...actions, { label: d.label, icon: 'timer-outline', onPress: d.open }]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {d.active ? <DisappearingIndicator d={d} /> : null}
      <IconButton icon="ellipsis-vertical" label={t('conv.more')} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={title} actions={all} />
      {d.sheet}
    </View>
  )
}
