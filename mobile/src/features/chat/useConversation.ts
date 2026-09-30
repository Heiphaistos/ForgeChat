import { useInfiniteQuery } from '@tanstack/react-query'
import * as Crypto from 'expo-crypto'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { messagesApi, type UploadFile } from '@/api/messages'
import { ALLOWED_UPLOAD_EXTENSIONS, LIMITS } from '@/config/env'
import { ApiError, errorMessage } from '@/lib/http'
import { logger } from '@/lib/logger'
import { realtime } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import { useUnread } from '@/stores/unread'
import type { Attachment, ChatMessage, ConversationRef } from '@/types/models'
import { conversationId } from './adapters'
import {
  appendMessage,
  applyReactionDelta,
  confirmMessage,
  flattenNewestFirst,
  messagesKey,
  patchMessage,
  removeMessage,
  type MessagesData,
} from './cache'
import { AttachmentUploadError } from './sendErrors'

export interface LocalAttachment extends UploadFile {
  size: number | null
}

/** Nettoie un nom de fichier (pas de chemin, caractères sûrs, longueur bornée). */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'fichier'
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^\.+/, '').slice(-100)
  return cleaned || 'fichier'
}

/**
 * Extension telle que le serveur la lit (Rust `Path::extension`, puis « bin » à défaut) :
 * « a.tar.gz » → gz, « README » ou « .env » → bin, « a. » → '' (refusé).
 */
export function uploadExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? 'bin' : base.slice(dot + 1).toLowerCase()
}

export function validateAttachment(f: LocalAttachment): string | null {
  const ext = uploadExtension(f.name)
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext))
    return `Type de fichier .${ext || '?'} non autorisé par le serveur. Formats acceptés : images (jpg, png, gif, webp), vidéos (mp4, mov, webm, mkv), audio (mp3, ogg, wav, flac), documents (pdf, txt, md, Office) et archives (zip, 7z, rar, tar, gz).`
  if (f.size != null && f.size > LIMITS.uploadMaxBytes) return 'Fichier trop volumineux (max 50 Mo)'
  return null
}

/**
 * État + actions d'une conversation (salon, DM ou groupe).
 * Les mises à jour temps réel arrivent via services/realtimeBindings.ts.
 */
export function useConversation(ref: ConversationRef) {
  const id = conversationId(ref)
  const key = messagesKey(ref.kind, id)
  const me = useAuth((s) => s.user)
  const refJson = JSON.stringify(ref)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRef = useMemo(() => ref, [refJson])

  const query = useInfiniteQuery<ChatMessage[], Error, MessagesData, typeof key, string | undefined>({
    queryKey: key,
    initialPageParam: undefined,
    queryFn: ({ pageParam, signal }) => messagesApi.list(stableRef, pageParam, signal),
    getNextPageParam: (last) => (last.length < LIMITS.pageSize ? undefined : last[0]?.id),
    staleTime: Infinity, // le WebSocket maintient le cache ; invalidé à la reconnexion
  })

  const messages = useMemo(() => flattenNewestFirst(query.data), [query.data])

  // ── Lecture ──────────────────────────────────────────────────────────────
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markRead = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current)
    readTimer.current = setTimeout(() => {
      messagesApi.markRead(stableRef)?.catch((e) => logger.debug('chat', 'markRead', e))
    }, 800)
  }, [stableRef])

  useEffect(() => {
    useUnread.getState().setActive(id)
    markRead()
    return () => {
      if (useUnread.getState().activeConversation === id) useUnread.getState().setActive(null)
      if (readTimer.current) clearTimeout(readTimer.current)
    }
  }, [id, markRead])

  const newestId = messages[0]?.id
  useEffect(() => {
    if (newestId && !newestId.startsWith('tmp-')) markRead()
  }, [newestId, markRead])

  // ── Saisie ───────────────────────────────────────────────────────────────
  const lastTyping = useRef(0)
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTyping.current < 3000) return
    lastTyping.current = now
    if (stableRef.kind === 'channel') realtime.send({ type: 'TYPING_START', channel_id: stableRef.channelId })
    else realtime.send({ type: 'TYPING', conversation_id: id })
  }, [stableRef, id])

  // ── Envoi ────────────────────────────────────────────────────────────────
  const send = useCallback(
    async (content: string, opts: { replyTo?: ChatMessage | null; files?: LocalAttachment[] } = {}) => {
      if (!me) return
      const text = content.trim()
      const files = opts.files ?? []
      if (!text && files.length === 0) return
      if (text.length > LIMITS.messageMaxChars) throw new Error(`Message trop long (max ${LIMITS.messageMaxChars} caractères)`)
      for (const f of files) {
        const err = validateAttachment(f)
        if (err) throw new Error(err)
      }

      const tempId = `tmp-${Crypto.randomUUID()}`
      const localAtts: Attachment[] = files.map((f, i) => ({
        id: `${tempId}-${i}`,
        url: f.uri,
        filename: f.name,
        content_type: f.type,
        size: f.size ?? 0,
      }))
      const optimistic: ChatMessage = {
        id: tempId,
        content: text || null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        authorId: me.id,
        authorName: me.username,
        authorAvatar: me.avatar,
        authorIsBot: false,
        reply: opts.replyTo
          ? { id: opts.replyTo.id, authorName: opts.replyTo.authorName, content: opts.replyTo.content }
          : null,
        forwardedFrom: null,
        attachments: localAtts,
        reactions: [],
        pinned: false,
        pending: true,
      }
      appendMessage(stableRef.kind, id, optimistic)

      // Échec de l'envoi lui-même (le message n'existe pas côté serveur) : on
      // marque la bulle optimiste en échec. Séparé de l'échec d'upload
      // ci-dessous, qui concerne un message déjà confirmé (id réel, plus tmp-) —
      // les fusionner ferait retomber sur un patch(tempId) devenu sans effet.
      let real: ChatMessage
      try {
        real = await messagesApi.send(stableRef, {
          content: text || null,
          replyTo: opts.replyTo?.id ?? null,
          hasAttachments: files.length > 0,
        })
      } catch (e) {
        // Le composer récupère le texte et les fichiers (sendErrors.restoreAfterSendError) :
        // on retire la bulle pour ne pas les afficher en double.
        removeMessage(stableRef.kind, id, tempId)
        throw e
      }
      confirmMessage(stableRef.kind, id, tempId, { ...real, awaitingAttachments: files.length > 0 })

      if (files.length) {
        try {
          const uploaded = await messagesApi.upload(stableRef, real.id, files)
          patchMessage(stableRef.kind, id, real.id, (m) => ({ ...m, attachments: uploaded, awaitingAttachments: false }))
        } catch (e) {
          if (!text) {
            // Sans texte, le message créé côté serveur resterait vide pour tout le monde : on le retire.
            await messagesApi.remove(stableRef, real.id).catch(() => undefined)
            removeMessage(stableRef.kind, id, real.id)
          } else {
            patchMessage(stableRef.kind, id, real.id, (m) => ({
              ...m,
              attachments: m.attachments.filter((a) => !a.id.startsWith('tmp-')),
              awaitingAttachments: false,
              failed: true,
            }))
          }
          throw new AttachmentUploadError(`Pièce jointe non envoyée : ${errorMessage(e)}`)
        }
      }
    },
    [me, stableRef, id],
  )

  const discardFailed = useCallback((messageId: string) => removeMessage(stableRef.kind, id, messageId), [stableRef, id])

  const edit = useCallback(
    async (messageId: string, content: string) => {
      const text = content.trim()
      if (!text) throw new Error('Le message ne peut pas être vide')
      if (text.length > LIMITS.messageMaxChars) throw new Error('Message trop long')
      let previous: string | null = null
      patchMessage(stableRef.kind, id, messageId, (m) => {
        previous = m.content
        return { ...m, content: text, editedAt: new Date().toISOString() }
      })
      try {
        await messagesApi.edit(stableRef, messageId, text)
      } catch (e) {
        patchMessage(stableRef.kind, id, messageId, (m) => ({ ...m, content: previous }))
        throw e
      }
    },
    [stableRef, id],
  )

  const remove = useCallback(
    async (messageId: string) => {
      await messagesApi.remove(stableRef, messageId)
      removeMessage(stableRef.kind, id, messageId)
    },
    [stableRef, id],
  )

  const react = useCallback(
    async (msg: ChatMessage, emoji: string) => {
      const mine = msg.reactions.find((r) => r.emoji === emoji)?.me ?? false
      if (stableRef.kind === 'channel') {
        // Le serveur diffuse REACTION_ADD/REMOVE à tous (nous compris) : pas d'optimisme ici.
        await messagesApi.react(stableRef, msg.id, emoji, mine)
        return
      }
      // DM/groupes : l'événement toggle revient aussi ; l'optimisme reste léger.
      applyReactionDelta(stableRef.kind, id, msg.id, emoji, mine ? -1 : 1, true)
      try {
        await messagesApi.react(stableRef, msg.id, emoji, mine)
      } catch (e) {
        applyReactionDelta(stableRef.kind, id, msg.id, emoji, mine ? 1 : -1, true)
        throw e
      }
    },
    [stableRef, id],
  )

  const loadOlder = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
  }, [query])

  return {
    id,
    ref: stableRef,
    messages,
    isLoading: query.isLoading,
    error: query.error,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    loadOlder,
    hasOlder: !!query.hasNextPage,
    loadingOlder: query.isFetchingNextPage,
    send,
    edit,
    remove,
    react,
    discardFailed,
    notifyTyping,
  }
}

export function isForbidden(e: unknown) {
  return e instanceof ApiError && e.status === 403
}
