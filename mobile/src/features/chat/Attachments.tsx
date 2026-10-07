import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useT } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { openExternalUrl, resolveMediaUrl } from '@/lib/links'
import type { Attachment } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { isVoiceAttachment } from '@/features/composer/formats'
import { mediaKind } from './media'
import { AudioAttachment, VideoAttachment } from './MediaPlayers'
import type { FileEntry } from '@/e2e/crypto'
import { AUTO_DECRYPT_MAX, decryptToCache, displayAttachments, saveToDevice, type DisplayAttachment } from '@/e2e/files'

const isLocal = (url: string) => /^(file|content|ph|assets-library):/.test(url)

function sourceOf(a: Attachment): string | null {
  if (isLocal(a.url)) return a.url // aperçu pendant l'envoi
  return resolveMediaUrl(a.url)
}

type Opened = { uri: string } | 'loading' | 'error'

/**
 * Fichiers chiffrés (§12) : déchiffrés dans le cache de l'appli (d'office si petits et
 * lisibles en ligne, sinon à la demande). Rend l'état de chacun et l'action « déchiffrer ».
 */
function useDecrypted(list: DisplayAttachment[]) {
  const [state, setState] = useState<Record<string, Opened>>({})
  // decryptToCache ne télécharge qu'une fois par fichier, même appelé plusieurs fois.
  const run = (a: DisplayAttachment) =>
    a.e2e &&
    decryptToCache(a.url, a.e2e).then(
      (uri) => setState((s) => ({ ...s, [a.id]: { uri } })),
      () => setState((s) => ({ ...s, [a.id]: 'error' })),
    )
  const auto = list.filter((a) => a.e2e && a.e2e.s <= AUTO_DECRYPT_MAX && mediaKind(a) !== 'file').map((a) => a.id).join(',')
  useEffect(() => {
    for (const a of list) if (auto.includes(a.id)) void run(a)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relancé seulement quand la liste à ouvrir change
  }, [auto])
  const open = (a: DisplayAttachment) => {
    if (!a.e2e || state[a.id]) return
    setState((s) => ({ ...s, [a.id]: 'loading' }))
    void run(a)
  }
  /** Déchiffrement d'office en cours : affiché comme « Déchiffrement… ». */
  const stateOf = (id: string): Opened | undefined => state[id] ?? (auto.includes(id) ? 'loading' : undefined)
  return { stateOf, open }
}

/**
 * `onLongPress` : menu du message (sans lui, un appui long sur une image l'ouvrirait).
 * `files` : fichiers chiffrés décrits dans le message déchiffré (clés).
 */
export function Attachments({ items: raw, files: entries, pending, onLongPress }: { items: Attachment[]; files?: FileEntry[]; pending?: boolean; onLongPress?: () => void }) {
  const [viewer, setViewer] = useState<string | null>(null)
  const t = useT()
  const display = useMemo(() => displayAttachments(raw, entries), [raw, entries])
  const { stateOf, open } = useDecrypted(display)
  if (!display.length) return null
  // Fichier chiffré déchiffré : son fichier temporaire remplace l'adresse du blob.
  const decrypted = new Set<string>()
  const items: DisplayAttachment[] = display.map((a) => {
    const st = stateOf(a.id)
    if (a.e2e && typeof st === 'object') {
      decrypted.add(a.id)
      return { ...a, url: st.uri }
    }
    return a
  })
  const sealed = items.filter((a) => (a.e2e || a.e2eLocked) && !decrypted.has(a.id))
  const plain = items.filter((a) => !sealed.includes(a))
  const images = plain.filter((a) => mediaKind(a) === 'image')
  // Vidéo/audio envoyés et servis par le serveur (ou déchiffrés ici) : lecteur intégré. Pendant l'envoi : carte « fichier ».
  const playable = (a: Attachment) => !pending && (decrypted.has(a.id) || (!isLocal(a.url) && !!resolveMediaUrl(a.url)))
  // Message vocal (web : .webm/.ogg ; app : .mp4) : lecteur audio, même si le serveur l'a typé vidéo.
  const players = plain.filter((a) => (mediaKind(a) === 'video' || mediaKind(a) === 'audio' || isVoiceAttachment(a)) && playable(a))
  const files = plain.filter((a) => mediaKind(a) !== 'image' && !players.includes(a))
  const srcOf = (a: Attachment) => (decrypted.has(a.id) ? a.url : sourceOf(a))

  return (
    <View style={{ gap: spacing.xs, marginTop: 4 }}>
      {images.length ? (
        <View style={styles.grid}>
          {images.map((a) => {
            const src = srcOf(a)
            if (!src) return null
            return (
              <Pressable
                key={a.id}
                onPress={() => !pending && setViewer(src)}
                onLongPress={onLongPress}
                delayLongPress={300}
                accessibilityRole="imagebutton"
                accessibilityLabel={t('panel.att.image', { name: a.filename })}
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

      {players.map((a) => {
        const src = decrypted.has(a.id) ? a.url : resolveMediaUrl(a.url)!
        if (isVoiceAttachment(a)) return <AudioAttachment key={a.id} src={src} attachment={a} voice onLongPress={onLongPress} />
        return mediaKind(a) === 'video' ? (
          <VideoAttachment key={a.id} src={src} label={t('panel.att.video', { name: a.filename })} />
        ) : (
          <AudioAttachment key={a.id} src={src} attachment={a} onLongPress={onLongPress} />
        )
      })}

      {sealed.map((a) => {
        const st = stateOf(a.id)
        const label = a.e2eLocked
          ? t('e2e.file.locked')
          : st === 'error'
            ? t('e2e.file.broken')
            : st === 'loading'
              ? t('e2e.file.decrypting')
              : `${formatBytes(a.size)} · ${t('e2e.file.tap')}`
        return (
          <Pressable
            key={a.id}
            style={styles.file}
            disabled={!a.e2e || pending || st === 'loading'}
            onPress={() => open(a)}
            onLongPress={onLongPress}
            delayLongPress={300}
            accessibilityRole="button"
            accessibilityLabel={t('panel.att.file', { name: a.filename })}
          >
            <Ionicons name="lock-closed-outline" size={24} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>
                {a.e2eLocked ? t('e2e.file.encrypted') : a.filename}
              </Text>
              <Text style={styles.fileMeta}>{label}</Text>
            </View>
          </Pressable>
        )
      })}

      {files.map((a) => {
        const src = srcOf(a)
        // Fichier déchiffré ici : pas d'adresse ouvrable par une autre appli, on l'enregistre (dossier au choix).
        const local = decrypted.has(a.id)
        return (
          <Pressable
            key={a.id}
            style={styles.file}
            disabled={!src || pending || (isLocal(a.url) && !local)}
            onPress={() =>
              local
                ? void saveToDevice(a.url, a.filename, a.content_type).then(
                    (ok) => ok && Alert.alert(t('e2e.file.saved')),
                    () => Alert.alert(t('e2e.file.saveFailed')),
                  )
                : src && void openExternalUrl(src)
            }
            onLongPress={onLongPress}
            delayLongPress={300}
            accessibilityRole="button"
            accessibilityLabel={t('panel.att.file', { name: a.filename })}
          >
            <Ionicons name={a.content_type.startsWith('video/') ? 'film-outline' : a.content_type.startsWith('audio/') ? 'musical-notes-outline' : 'document-outline'} size={26} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fileName} numberOfLines={1}>
                {a.filename}
              </Text>
              <Text style={styles.fileMeta}>{pending ? t('panel.att.sending') : formatBytes(a.size)}</Text>
            </View>
            {!pending ? <Ionicons name={local ? 'download-outline' : 'open-outline'} size={18} color={colors.textMuted} /> : null}
          </Pressable>
        )
      })}

      <Lightbox uri={viewer} onClose={() => setViewer(null)} />
    </View>
  )
}

function Lightbox({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const t = useT()
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.lightbox}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        <Pressable
          onPress={onClose}
          style={[styles.close, { top: insets.top + spacing.md }]}
          accessibilityRole="button"
          accessibilityLabel={t('panel.att.closeImage')}
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
