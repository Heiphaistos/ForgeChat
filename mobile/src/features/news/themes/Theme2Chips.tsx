// Thème 2 : bandeau de puces au-dessus des articles — groupes, puis rubriques du groupe, puis sources de la rubrique.
import { Ionicons } from '@expo/vector-icons'
import { useState, type ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { colors, spacing } from '@/theme'
import { groupOf, viewCategory, type GroupId } from '../logic'
import { GROUP_COLOR, GROUP_ICON, Avatar, Chip, askMove, isCurrent, rubricIcon, s, type Nav } from '../shared'

/** Groupe de la vue courante (rubrique ou site), sinon null. */
export function currentGroup(nav: Nav): GroupId | null {
  const cat = viewCategory(nav.view)
  return cat === null ? null : groupOf(cat)
}

const Row = ({ children }: { children: ReactNode }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }} keyboardShouldPersistTaps="handled">
    {children}
  </ScrollView>
)
const num = (n: number, on: boolean) => (n > 0 ? <Text style={{ fontSize: 11, fontWeight: '700', color: on ? '#fff' : colors.primary }}>{n}</Text> : null)

export default function Theme2Chips({ nav }: { nav: Nav }) {
  const { t, view } = nav
  const [sel, setSel] = useState<GroupId | null>(null)
  const gid = currentGroup(nav) ?? sel
  const group = nav.groups.find((g) => g.id === gid)
  const cat = viewCategory(view)
  const rubric = cat === null ? undefined : nav.rubrics.find((r) => r.cat === cat)
  const cats = group?.rubrics.map((r) => r.cat) ?? []
  const text = (on: boolean) => [s.chipText, on && { color: '#fff' }]

  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
      <Row>
        <Chip on={view.kind === 'top' && !sel} onPress={() => { setSel(null); nav.pick({ kind: 'top' }) }} label={t('news.top')}>
          <Ionicons name="flame" size={14} color="#fb923c" />
          <Text style={text(view.kind === 'top' && !sel)}>{t('news.top')}</Text>
        </Chip>
        {nav.groups.map((g) => {
          const on = gid === g.id
          return (
            <Chip key={g.id} on={on} color={GROUP_COLOR[g.id]} label={t(`news.group.${g.id}`)}
              onPress={() => { setSel(g.id); if (gid !== g.id && view.kind !== 'top') nav.pick({ kind: 'top' }) }}>
              <Ionicons name={GROUP_ICON[g.id]} size={14} color={on ? '#fff' : colors.textMuted} />
              <Text style={text(on)}>{t(`news.group.${g.id}`)}</Text>
              {num(g.today, on)}
            </Chip>
          )
        })}
      </Row>
      {group ? (
        <Row>
          {group.rubrics.map((r) => {
            const on = rubric?.cat === r.cat
            return (
              <Chip key={r.cat} on={on} label={r.short} onPress={() => nav.pick({ kind: 'category', category: r.cat })} onLongPress={() => askMove(nav, cats, r.cat)}>
                <Ionicons name={rubricIcon(r.cat)} size={14} color={on ? colors.text : colors.textMuted} />
                <Text style={[s.chipText, on && { color: colors.text }]}>{r.short}</Text>
                {num(r.today, false)}
              </Chip>
            )
          })}
        </Row>
      ) : null}
      {rubric ? (
        <Row>
          {rubric.sites.map((x) => {
            const on = isCurrent(view, x)
            return (
              <Chip key={x.id} on={on} label={x.name} onPress={() => nav.pick({ kind: 'site', site: x })}>
                <Avatar name={x.name} size={18} />
                <Text style={[s.chipText, on && { color: colors.text }]}>{x.name}</Text>
                {num(x.today, false)}
              </Chip>
            )
          })}
        </Row>
      ) : null}
    </View>
  )
}
