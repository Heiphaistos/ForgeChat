import { memo, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { openExternalUrl } from '@/lib/links'
import { parseMarkdown, type InlineNode } from '@/lib/markdown'
import { colors, font, radius, spacing } from '@/theme'

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <Text
      onPress={() => setShown(true)}
      accessibilityRole="button"
      accessibilityLabel={shown ? undefined : 'Spoiler masqué, toucher pour révéler'}
      style={shown ? styles.spoilerShown : styles.spoiler}
    >
      {children}
    </Text>
  )
}

function renderInline(nodes: InlineNode[], myName: string | undefined, keyPrefix = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`
    switch (n.t) {
      case 'text':
        return n.v
      case 'code':
        return (
          <Text key={key} style={styles.inlineCode}>
            {n.v}
          </Text>
        )
      case 'bold':
        return (
          <Text key={key} style={styles.bold}>
            {renderInline(n.c, myName, `${key}.`)}
          </Text>
        )
      case 'italic':
        return (
          <Text key={key} style={styles.italic}>
            {renderInline(n.c, myName, `${key}.`)}
          </Text>
        )
      case 'strike':
        return (
          <Text key={key} style={styles.strike}>
            {renderInline(n.c, myName, `${key}.`)}
          </Text>
        )
      case 'spoiler':
        return <Spoiler key={key}>{renderInline(n.c, myName, `${key}.`)}</Spoiler>
      case 'link':
        return (
          <Text key={key} style={styles.link} onPress={() => void openExternalUrl(n.url)} accessibilityRole="link">
            {n.url}
          </Text>
        )
      case 'mention': {
        const isMe = n.everyone || (!!myName && n.v.toLowerCase() === myName.toLowerCase())
        const label = /^[0-9a-f-]{36}$/i.test(n.v) ? '@membre' : `@${n.v}`
        return (
          <Text key={key} style={[styles.mention, isMe && styles.mentionMe]}>
            {label}
          </Text>
        )
      }
    }
  })
}

export const MessageText = memo(function MessageText({ content, myName }: { content: string; myName?: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((b, i) => {
        if (b.t === 'codeblock')
          return (
            <View key={i} style={styles.codeBlock}>
              <Text style={styles.codeBlockText} selectable>
                {b.v}
              </Text>
            </View>
          )
        if (b.t === 'quote')
          return (
            <View key={i} style={styles.quote}>
              <Text style={styles.text}>{renderInline(b.c, myName)}</Text>
            </View>
          )
        return (
          <Text key={i} style={styles.text} selectable>
            {renderInline(b.c, myName)}
          </Text>
        )
      })}
    </View>
  )
})

const mono = 'Menlo'

const styles = StyleSheet.create({
  text: { color: colors.textSecondary, fontSize: font.md, lineHeight: 21 },
  bold: { fontWeight: '700', color: colors.text },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: colors.link, textDecorationLine: 'underline' },
  mention: { color: '#c9cdfb', backgroundColor: 'rgba(88,101,242,0.3)', fontWeight: '600' },
  mentionMe: { backgroundColor: 'rgba(250,168,26,0.35)', color: '#fff' },
  inlineCode: { fontFamily: mono, backgroundColor: colors.codeBg, color: colors.text, fontSize: font.sm },
  codeBlock: { backgroundColor: colors.codeBg, borderRadius: radius.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border },
  codeBlockText: { fontFamily: mono, color: colors.text, fontSize: font.sm },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.textFaint, paddingLeft: spacing.sm },
  spoiler: { backgroundColor: colors.bgDeep, color: colors.bgDeep, borderRadius: 4 },
  spoilerShown: { backgroundColor: colors.bgHover },
})
