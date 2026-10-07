// Ligne de statut riche (listes de membres, d'amis, en-tête de MP).
import { Text, type TextStyle } from 'react-native'
import { useT } from '@/i18n'
import { colors, font } from '@/theme'
import { richText, type RichActivity } from './rich'

export function RichStatusText({ activity, style }: { activity: RichActivity | null | undefined; style?: TextStyle }) {
  const t = useT()
  const text = richText(activity, t)
  if (!text) return null
  return (
    <Text style={[{ color: colors.textMuted, fontSize: font.sm }, style]} numberOfLines={1}>
      {text}
    </Text>
  )
}
