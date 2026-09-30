import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatBytes } from '@/lib/format'
import { openExternalUrl, resolveMediaUrl } from '@/lib/links'
import type { Attachment } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'

const isLocal = (url: string) => /^(file|content|ph|assets-library):/.test(url)

function sourceOf(a: Attachment): string | null {
  if (isLocal(a.url)) return a.url // aperçu pendant l'envoi
  return resolveMediaUrl(a.url)
}

export function Attachments({ items, pending }: { items: Attachment[]; pending?: boolean }) {
  const [viewer, setViewer] = useState<string | null>(null)
  if (!items.length) return null
  const images = items.filter((a) => a.content_type.startsWith('image/'))
  const files = items.filter((a) => !a.content_type.startsWith('image/'))

  return (
    <View style={{ gap: spacing.xs, marginTop: 4 }}>
      {images.length ? (
        <View style={styles.grid}>
          {images.map((a) => {
            const src = sourceOf(a)
            if (!src) return null
            return (
              <Pressable
                key={a.id}
                onPress={() => !pending && setViewer(src)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Image ${a.filename}`}
              >
                <Image
                  source={{ uri: src }}
                  style={[styles.image, images.length > 1 && styles.imageSmall, pending && { opacity: 0.5 }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={150}
                />
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {files.map((a) => {
        const src = sourceOf(a)
        return (
          <Pressable
            key={a.id}
            style={styles.file}
            disabled={!src || pending || isLocal(a.url)}
            onPress={() => src && void openExternalUrl(src)}
            accessibilityRole="button"
            accessibilityLabel={`Fichier ${a.filename}`}
          >
            <Ionicons name={a.content_type.startsWith('video/') ? 'film-outline' : a.content_type.startsWith('audio/') ? 'musical-notes-outline' : 'document-outline'} size={26} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>
                {a.filename}
              </Text>
              <Text style={styles.fileMeta}>{pending ? 'Envoi…' : formatBytes(a.size)}</Text>
            </View>
            {!pending ? <Ionicons name="open-outline" size={18} color={colors.textMuted} /> : null}
          </Pressable>
        )
      })}

      <Lightbox uri={viewer} onClose={() => setViewer(null)} />
    </View>
  )
}

function Lightbox({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.lightbox}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        <Pressable
          onPress={onClose}
          style={[styles.close, { top: insets.top + spacing.md }]}
          accessibilityRole="button"
          accessibilityLabel="Fermer l'image"
          hitSlop={12}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  image: { width: 240, height: 180, borderRadius: radius.md, backgroundColor: colors.bgElevated },
  imageSmall: { width: 140, height: 140 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    maxWidth: 320,
  },
  fileName: { color: colors.link, fontSize: font.md, fontWeight: '600' },
  fileMeta: { color: colors.textMuted, fontSize: font.xs },
  lightbox: { flex: 1, backgroundColor: '#000' },
  close: { position: 'absolute', right: spacing.lg, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 6 },
})
