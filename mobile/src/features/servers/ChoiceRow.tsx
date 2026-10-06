import { useState } from 'react'
import { Sheet } from '@/components/Sheet'
import { Row, type IconName } from '@/components/ui'

/** Ligne de réglage qui ouvre une liste de choix en feuille du bas (remplace le <select> du web). */
export function ChoiceRow<V extends string | number | null>({
  title,
  icon,
  value,
  options,
  onChange,
  disabled,
}: {
  title: string
  icon?: IconName
  value: V
  options: { value: V; label: string }[]
  onChange: (v: V) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)?.label ?? '—'
  return (
    <>
      <Row icon={icon} title={title} subtitle={current} chevron={!disabled} onPress={disabled ? undefined : () => setOpen(true)} />
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={title}
        actions={options.map((o) => ({ label: o.label, icon: 'ellipse-outline', selected: o.value === value, onPress: () => onChange(o.value) }))}
      />
    </>
  )
}
