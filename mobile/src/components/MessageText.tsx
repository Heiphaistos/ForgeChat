import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { messagesApi } from '@/api/messages'
import { safeEmojiUrl, useCustomEmojis } from '@/features/chat/customEmojis'
import { cachedChannel, cachedRole, cachedUsername, roleColor } from '@/features/chat/tokens'
import { openExternalUrl } from '@/lib/links'
import { formatTimestamp, parseMarkdown, type InlineNode } from '@/lib/markdown'
import { queryClient } from '@/lib/queryClient'
import { colors, font, isLight, radius, spacing } from '@/theme'

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

/** Emoji d'un autre serveur : image retrouvée par identifiant (GET /emojis/:id, gardée en cache). */
function RemoteEmoji({ id, name }: { id: string; name: string }) {
  const { data } = useQuery({ queryKey: ['emoji', id], queryFn: () => messagesApi.emoji(id), staleTime: Infinity, gcTime: Infinity, retry: false })
  const url = safeEmojiUrl(data?.url)
  if (!url) return `:${name}:`
  return <Image source={{ uri: url }} style={styles.emoji} contentFit="contain" accessibilityLabel={`:${name}:`} />
}

function ChannelChip({ id }: { id: string }) {
  const c = cachedChannel(queryClient, id)
  if (!c) return <Text style={styles.mention}>#salon-inconnu</Text>
  const serverId = c.server_id
  const open =
    serverId && (c.type === 'text' || c.type === 'announcement')
      ? () => router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId, channelId: c.id, name: c.name } })
      : undefined
  return (
    <Text style={styles.mention} onPress={open} accessibilityRole={open ? 'link' : undefined}>
      #{c.name}
    </Text>
  )
}

function renderInline(nodes: InlineNode[], myName: string | undefined, emojis: ReadonlyMap<string, string>, keyPrefix = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`
    const children = 'c' in n ? renderInline(n.c, myName, emojis, `${key}.`) : null
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
            {children}
          </Text>
        )
      case 'italic':
        return (
          <Text key={key} style={styles.italic}>
            {children}
          </Text>
        )
      case 'underline':
        return (
          <Text key={key} style={styles.underline}>
            {children}
          </Text>
        )
      case 'strike':
        return (
          <Text key={key} style={styles.strike}>
            {children}
          </Text>
        )
      case 'spoiler':
        return <Spoiler key={key}>{children}</Spoiler>
      case 'link':
        return (
          <Text
            key={key}
            style={styles.link}
            onPress={() => void openExternalUrl(n.url)}
            accessibilityRole="link"
            accessibilityHint={n.label ? `Ouvre ${n.url}` : undefined}
          >
            {n.label ?? n.url}
          </Text>
        )
      case 'emoji': {
        const url = emojis.get(n.v)
        return url ? (
          <Image key={key} source={{ uri: url }} style={styles.emoji} contentFit="contain" accessibilityLabel={`:${n.v}:`} />
        ) : (
          `:${n.v}:`
        )
      }
      case 'remoteEmoji':
        return <RemoteEmoji key={key} id={n.id} name={n.name} />
      case 'time':
        return (
          <Text key={key} style={styles.time}>
            {formatTimestamp(n.unix, n.fmt)}
          </Text>
        )
      case 'role': {
        const role = cachedRole(queryClient, n.id)
        const color = roleColor(role?.color)
        return (
          <Text key={key} style={[styles.mention, color ? { color, backgroundColor: `${color}33` } : null]}>
            @{role?.name ?? 'rôle-supprimé'}
          </Text>
        )
      }
      case 'channel':
        return <ChannelChip key={key} id={n.id} />
      case 'mention': {
        const isId = /^[0-9a-f-]{36}$/i.test(n.v)
        const name = isId ? cachedUsername(queryClient, n.v) : n.v
        const isMe = n.everyone || (!!myName && !!name && name.toLowerCase() === myName.toLowerCase())
        return (
          <Text key={key} style={[styles.mention, isMe && styles.mentionMe]}>
            @{name ?? 'membre'}
          </Text>
        )
      }
    }
  })
}

const HEADING = { 1: { fontSize: 22, lineHeight: 28 }, 2: { fontSize: 19, lineHeight: 25 }, 3: { fontSize: 17, lineHeight: 23 } } as const

export const MessageText = memo(function MessageText({ content, myName }: { content: string; myName?: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  const emojis = useCustomEmojis()
  return (
    <View style={{ gap: 4 }}>
      {blocks.map((b, i) => {
        if (b.t === 'codeblock')
          return (
            <View key={i} style={styles.codeBlock}>
              {b.lang ? <Text style={styles.codeLang}>{b.lang}</Text> : null}
              <Text style={styles.codeBlockText} selectable>
                {b.v}
              </Text>
            </View>
          )
        if (b.t === 'quote')
          return (
            <View key={i} style={styles.quote}>
              <Text style={styles.text}>{renderInline(b.c, myName, emojis)}</Text>
            </View>
          )
        if (b.t === 'heading')
          return (
            <Text key={i} style={[styles.heading, HEADING[b.level]]} accessibilityRole="header" selectable>
              {renderInline(b.c, myName, emojis)}
            </Text>
          )
        return (
          <Text key={i} style={styles.text} selectable>
            {renderInline(b.c, myName, emojis)}
          </Text>
        )
      })}
    </View>
  )
})

const mono = 'Menlo'

const styles = StyleSheet.create({
  text: { color: colors.textSecondary, fontSize: font.md, lineHeight: 21 },
  heading: { color: colors.text, fontWeight: '800' },
  bold: { fontWeight: '700', color: colors.text },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: colors.link, textDecorationLine: 'underline' },
  emoji: { width: 20, height: 20 },
  mention: { color: isLight ? colors.primaryPressed : '#c9cdfb', backgroundColor: colors.primary + '4d', fontWeight: '600' },
  mentionMe: { backgroundColor: 'rgba(250,168,26,0.35)', color: colors.text },
  time: { backgroundColor: colors.bgHover, color: colors.text, fontWeight: '600' },
  inlineCode: { fontFamily: mono, backgroundColor: colors.codeBg, color: colors.text, fontSize: font.sm },
  codeBlock: { backgroundColor: colors.codeBg, borderRadius: radius.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border },
  codeLang: { color: colors.textMuted, fontSize: font.xs, fontFamily: mono, marginBottom: 2 },
  codeBlockText: { fontFamily: mono, color: colors.text, fontSize: font.sm },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.textFaint, paddingLeft: spacing.sm },
  spoiler: { backgroundColor: colors.bgDeep, color: colors.bgDeep, borderRadius: 4 },
  spoilerShown: { backgroundColor: colors.bgHover },
})
