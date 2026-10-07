import { useEffect, useState, useCallback, useRef } from 'react'
import NativeVideo from '../components/voice/NativeVideo'
import FullscreenVideo from '../components/voice/FullscreenVideo'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, Video, Search, Mic, MicOff, PhoneOff, VideoOff, ChevronLeft, Pin, X, Maximize2 } from 'lucide-react'
import api, { mediaUrl } from '../api/client'
import { useChat, useDraft } from '../store/chat'
import { postWithUploadProgress } from '../utils/uploadProgress'
import { useWs } from '../store/ws'
import { usePresence } from '../store/presence'
import RichStatus from '../components/ui/RichStatus'
import { useAuth } from '../store/auth'
import { useUnread } from '../store/unread'
import { useWakeLock } from '../hooks/useWakeLock'
import { useCallStore } from '../store/call'
import { useFormatDate } from '../hooks/useFormatDate'
import DMConversation from '../components/chat/DMConversation'
import SearchPanel from '../components/chat/SearchPanel'
import toast from 'react-hot-toast'
import { useMobile } from '../contexts/MobileContext'
import { useT, t as tr, type Key } from '../i18n'
import { keysFor, onKeysChanged, openMessage, openText, reopenLocked, withSeal, sendErrorText, type RawMsg } from '../e2e/conversations'
import type { EncPayload } from '../e2e/crypto'
import { E2EBadge, useConvEncrypted } from '../e2e/E2EBadge'
import DisappearingControl from '../components/chat/DisappearingControl'
import { rememberConvName } from '../e2e/searchIndex'
import { E2ECallBadge } from '../e2e/E2ECallBadge'
import { filesExtra, prepareFiles, type PreparedFiles } from '../e2e/files'
import { isQueued } from '../lib/offline'
import { RemoteSupportButton, useSupportSender } from '../components/chat/RemoteSupport'
import type { SupportPayload } from '../lib/remoteSupport'

/** Message de MP tel que renvoyé par le serveur. */
type RawDm = RawMsg & { reply_to?: { id: string; content: string | null; enc?: EncPayload | null; client_msg_id?: string | null; sender_id: string; sender_username: string } | null }

/** Déchiffre un MP et l'aperçu du message auquel il répond. */
async function openDm(dmId: string, m: RawDm) {
  const o = await openMessage('dm', dmId, m)
  const r = m.reply_to
  if (r?.enc) {
    const text = await openText('dm', dmId, r.enc, r.sender_id, r.client_msg_id)
    return { ...o, reply_to: { ...r, content: text ?? tr('e2e.msg.locked') }, ...(text === null ? { e2e_reply: 'locked' as const } : {}) }
  }
  return o
}


const STATUS_LABEL: Record<string, Key> = {
  online: 'presence.online',
  idle: 'presence.idle',
  dnd: 'presence.dnd',
  invisible: 'presence.invisible',
  offline: 'presence.offline',
}

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

export default function DMPage() {
  const t = useT()
  const { dmId } = useParams<{ dmId: string }>()
  const [searchParams] = useSearchParams()
  const highlightMessageId = searchParams.get('highlight')
  const nav = useNavigate()
  const { openSidebar } = useMobile()
  const { addMessages, addMessage, clearChannel, updateMessage } = useChat()
  const qc = useQueryClient()
  const { on } = useWs()
  const presenceStatuses = usePresence(s => s.statuses)
  const getStatus = (id: string) => presenceStatuses[id] ?? 'offline'
  const presenceActivities = usePresence(s => s.activities)
  const me = useAuth(s => s.user)
  const resetUnread = useUnread(s => s.reset)
  const { formatShort } = useFormatDate()
  const { encrypted } = useConvEncrypted('dm', dmId)
  const [showSearch, setShowSearch] = useState(false)
  const [hasMoreDM, setHasMoreDM] = useState(true)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  // Vidéo du correspondant en plein écran (double-clic ou bouton).
  const [videoFullscreen, setVideoFullscreen] = useState(false)

  const loadMoreDM = useCallback(async (): Promise<boolean> => {
    if (!dmId || !hasMoreDM) return false
    const msgs = useChat.getState().messagesByChannel[dmId] ?? []
    if (msgs.length === 0) return false
    const oldestId = msgs[0].id
    try {
      const { data: raw } = await api.get<RawDm[]>(`/dms/${dmId}/messages?before=${oldestId}&limit=50`)
      if (raw.length === 0) { setHasMoreDM(false); return false }
      const data = await Promise.all(raw.map(m => openDm(dmId, m)))
      const normalized = data.map((m: any) => ({
        ...m,
        channel_id: dmId,
        author_id: m.sender_id,
        author_username: m.sender_username,
        author_avatar: m.sender_avatar,
        author_avatar_decoration: m.sender_avatar_decoration ?? null,
        author_discriminator: '0000',
        reply_to: m.reply_to_id ?? null,
        reply_to_content: m.reply_to?.content ?? null,
        reply_to_username: m.reply_to?.sender_username ?? null,
        attachments: m.attachments ?? [],
        reactions: m.reactions ?? [],
        type: 'default',
        pinned: false,
      }))
      addMessages(dmId, normalized, true)
      if (data.length < 50) setHasMoreDM(false)
      return true
    } catch (e: any) {
      if (e?.response?.status === 404) setHasMoreDM(false)
      return false
    }
  }, [dmId, hasMoreDM, addMessages])

  const { data: dmInfo } = useQuery({
    queryKey: ['dm_info', dmId],
    queryFn: () => api.get('/dms').then(r => {
      const dms: any[] = r.data
      return dms.find(d => d.id === dmId) ?? null
    }),
    enabled: !!dmId,
  })

  // Derive partner info after query
  const partnerName = dmInfo?.username ?? 'Utilisateur'
  const partnerAvatar = dmInfo?.avatar ?? null
  const partnerId = dmInfo?.other_user_id ?? ''
  const partnerActivity = presenceActivities[partnerId]
  const status = partnerId ? getStatus(partnerId) : 'offline'

  // Nom de la conversation pour le filtre dans: de la recherche locale.
  useEffect(() => { if (dmId && dmInfo?.username) rememberConvName(dmId, dmInfo.username) }, [dmId, dmInfo?.username])

  useEffect(() => {
    if (partnerName === 'Utilisateur') return
    const prefix = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
    document.title = `${prefix}@${partnerName} | ForgeChat`
    return () => {
      const p = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
      document.title = `${p}ForgeChat`
    }
  }, [partnerName])

  // État d'appel global (store/call.ts) — persiste hors du cycle de vie de cette page,
  // donc l'appel ne raccroche/ne coupe plus le son si on navigue ailleurs (Paramètres,
  // autre conversation...). isThisCallActive distingue "un appel tourne, et c'est CELUI
  // de cette conversation" de "un appel tourne ailleurs" (ne pas afficher/permettre de
  // raccrocher le mauvais appel depuis une autre page de DM).
  const {
    dmId: activeCallDmId, callState, callType, localStream, remoteStream, remoteVideoUrl, localVideoUrl, micMuted, camOff,
    startCall, acceptCall, hangup, toggleMic, toggleCam,
    pendingAccept, setPendingAccept, e2ee: callE2ee, e2eeOutdated,
  } = useCallStore()
  const isThisCallActive = callState !== 'idle' && activeCallDmId === dmId
  const callBusyElsewhere = callState !== 'idle' && activeCallDmId !== dmId

  // ── Messages épinglés du DM ─────────────────────────────────────────────────
  interface DmPin {
    id: string
    message_id: string
    pinned_at: string
    pinned_by: string
    message: { content: string | null; enc?: EncPayload | null; client_msg_id?: string | null; sender_id: string; sender_name: string; created_at: string }
  }
  const [showPins, setShowPins] = useState(false)
  const { data: dmPins = [] } = useQuery<DmPin[]>({
    queryKey: ['dm_pins', dmId],
    queryFn: async () => {
      const pins: DmPin[] = (await api.get(`/dms/${dmId}/pins`)).data
      return Promise.all(pins.map(async p => p.message.enc
        ? { ...p, message: { ...p.message, content: await openText('dm', dmId!, p.message.enc, p.message.sender_id, p.message.client_msg_id) ?? tr('e2e.msg.locked') } }
        : p))
    },
    enabled: !!dmId,
    staleTime: 30_000,
  })


  const togglePin = useMutation({
    mutationFn: ({ msgId, pinned }: { msgId: string; pinned: boolean }) =>
      pinned ? api.delete(`/dms/${dmId}/pins/${msgId}`) : api.post(`/dms/${dmId}/pins/${msgId}`),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['dm_pins', dmId] })
      toast.success(vars.pinned ? t('dm.unpinned') : t('dm.pinned'))
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error ?? t('common.error'))
    },
  })

  // Garder l'écran allumé pendant un appel DM (mobile), quelle que soit la conversation
  // affichée — l'appel peut être actif alors qu'on navigue ailleurs
  useWakeLock(callState !== 'idle')

  // Tonalité de retour pendant que ça sonne chez le correspondant — gérée globalement
  // dans PersistentDmCallAudio (survit à la navigation), pas ici.

  // Durée de l'appel connecté (mm:ss, h:mm:ss au-delà d'une heure) — dérivée de
  // connectedAt (persisté dans le store), pas d'un timer local à la page : revenir sur
  // la conversation après avoir navigué ailleurs affiche la vraie durée, pas 0.
  const connectedAt = useCallStore(s => s.connectedAt)
  const [callSeconds, setCallSeconds] = useState(0)
  useEffect(() => {
    if (!isThisCallActive || callState !== 'connected' || !connectedAt) { setCallSeconds(0); return }
    const update = () => setCallSeconds(Math.floor((Date.now() - connectedAt) / 1000))
    update()
    const iv = setInterval(update, 1000)
    return () => clearInterval(iv)
  }, [isThisCallActive, callState, connectedAt])
  const callDuration = callSeconds >= 3600
    ? `${Math.floor(callSeconds / 3600)}:${String(Math.floor((callSeconds % 3600) / 60)).padStart(2, '0')}:${String(callSeconds % 60).padStart(2, '0')}`
    : `${Math.floor(callSeconds / 60)}:${String(callSeconds % 60).padStart(2, '0')}`

  // Auto-accept call if navigated here from incoming call modal
  // dmInfo must be loaded (so dmId is confirmed valid) before accepting
  useEffect(() => {
    if (pendingAccept && dmId && dmInfo) {
      const { fromUserId, callType: ct } = pendingAccept
      setPendingAccept(null)
      acceptCall(dmId, fromUserId, ct)
    }
  }, [pendingAccept, dmId, dmInfo])

  // Attacher les flux aux <video> de CETTE page — seulement si l'appel actif est bien
  // celui de la conversation affichée (isThisCallActive). L'audio distant est géré par
  // PersistentDmCallAudio (composant global), plus par un <audio> local ici.
  useEffect(() => {
    if (localVideoRef.current && localStream && isThisCallActive) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream, isThisCallActive])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream && isThisCallActive) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream, isThisCallActive])

  const { data: messages = [], isError: dmMessagesError, refetch: refetchDmMessages } = useQuery({
    queryKey: ['dm_messages', dmId, highlightMessageId ?? null],
    queryFn: async () => {
      const open = (list: RawDm[]) => Promise.all(list.map(m => openDm(dmId!, m)))
      if (highlightMessageId) {
        try {
          const res = await api.get(`/dms/${dmId}/messages?around=${highlightMessageId}&limit=50`)
          if (res.data?.length > 0) return open(res.data)
        } catch {}
      }
      return api.get(`/dms/${dmId}/messages`).then(r => open(r.data))
    },
    enabled: !!dmId,
    staleTime: highlightMessageId ? 0 : 30_000,
  })

  // Refléter l'état épinglé sur les messages du store (chargés avant/après les pins)
  useEffect(() => {
    if (!dmId) return
    const pinnedIds = new Set(dmPins.map(p => p.message_id))
    const msgs = useChat.getState().messagesByChannel[dmId] ?? []
    msgs.forEach(m => {
      if (!!m.pinned !== pinnedIds.has(m.id)) updateMessage(dmId, m.id, { pinned: pinnedIds.has(m.id) })
    })
  }, [dmPins, dmId, messages])

  // Populate chat store with normal messages
  useEffect(() => {
    if (messages.length > 0 && dmId) {
      if (highlightMessageId) clearChannel(dmId)
      const normalized = messages.map((m: any) => ({
        ...m,
        channel_id: dmId,
        author_id: m.sender_id,
        author_username: m.sender_username,
        author_avatar: m.sender_avatar,
        author_avatar_decoration: m.sender_avatar_decoration ?? null,
        author_discriminator: '0000',
        reply_to: m.reply_to_id ?? null,
        reply_to_content: m.reply_to?.content ?? null,
        reply_to_username: m.reply_to?.sender_username ?? null,
        attachments: m.attachments ?? [],
        reactions: m.reactions ?? [],
        type: 'default',
        pinned: false,
      }))
      addMessages(dmId, normalized)
    }
  }, [messages])

  // Reset pagination quand on change de conversation
  useEffect(() => { setHasMoreDM(true) }, [dmId])
  useEffect(() => { if (highlightMessageId) setHasMoreDM(true) }, [highlightMessageId])

  // Ctrl+F global → toggle recherche dans ce DM
  useEffect(() => {
    const handler = () => setShowSearch(s => !s)
    window.addEventListener('forgechat:toggle-search', handler)
    return () => window.removeEventListener('forgechat:toggle-search', handler)
  }, [])

  // Effacer le badge non-lu quand on ouvre ou focus le DM + signaler au serveur
  useEffect(() => {
    if (!dmId) return
    const markRead = () => {
      resetUnread(dmId)
      api.post(`/dms/${dmId}/read`).catch(() => {})
    }
    markRead()
    window.addEventListener('focus', markRead)
    return () => window.removeEventListener('focus', markRead)
  }, [dmId])

  // Nouveaux messages (déchiffrés sur l'appareil)
  useEffect(() => {
    if (!dmId) return
    const off = on('DM_MESSAGE', async (raw: any) => {
      if (raw.dm_id === dmId && !raw.pending_attachments) {
        const d = { ...raw, message: await openDm(dmId, raw.message) }
        addMessage({
          ...d.message,
          channel_id: dmId,
          author_id: d.message.sender_id,
          author_username: d.message.sender_username ?? 'Utilisateur',
          author_avatar: d.message.sender_avatar ?? null,
          author_avatar_decoration: d.message.sender_avatar_decoration ?? null,
          author_discriminator: '0000',
          reply_to: d.message.reply_to_id ?? null,
          reply_to_content: d.message.reply_to?.content ?? null,
          reply_to_username: d.message.reply_to?.sender_username ?? null,
          attachments: d.message.attachments ?? [],
          reactions: d.message.reactions ?? [],
          type: 'default',
          pinned: false,
          edited_at: null,
        })
      }
    })
    // Clés reçues ou clé de compte prête : les messages en attente s'ouvrent (épinglés : E2EGate relit les requêtes).
    const offKeys = onKeysChanged(async (k, i) => {
      if (!keysFor('dm', dmId, k, i)) return
      const opened = await reopenLocked('dm', dmId, useChat.getState().messagesByChannel[dmId] ?? [])
      opened.forEach((o, id) => updateMessage(dmId, id, {
        content: o.content, e2e: o.e2e, e2e_body: o.e2e_body, e2e_reply: o.e2e_reply, reply_to_content: o.reply_to_content,
      } as never))
    })
    return () => { off(); offKeys() }
  }, [dmId])

  // Le serveur diffuse DM_PIN_TOGGLE aux deux participants (pin_dm_message/
  // unpin_dm_message, dm_extras.rs) -- sans ce listener, seul l'auteur du clic
  // (invalidation locale dans la mutation togglePin) voyait le panneau épinglés
  // se mettre à jour ; le partenaire restait figé sur l'ancien état tant qu'il ne
  // fermait/rouvrait pas le panneau. Même pattern que GroupDMPage/GROUP_DM_PIN_TOGGLE.
  useEffect(() => {
    if (!dmId) return
    const off = on('DM_PIN_TOGGLE', (d: any) => {
      if (d.dm_id !== dmId) return
      qc.invalidateQueries({ queryKey: ['dm_pins', dmId] })
    })
    return off
  }, [dmId])

  // Normal DM mutation (non-E2E)
  const sendDm = useMutation({
    mutationFn: ({ content, replyTo, files, extra }: { content: string | null; replyTo?: string; files?: PreparedFiles; extra?: Record<string, unknown> }) =>
      withSeal('dm', dmId!, content ?? '', body => api.post(`/dms/${dmId}/messages`, {
        ...body,
        content: body.content ?? '',
        reply_to: replyTo,
        has_attachments: !!files?.count,
      }), null, { extra: { ...filesExtra(files), ...extra } }),
    onSuccess: async (res, vars) => {
      const msg = res.data
      if (msg && me && dmId) {
        const reply = msg.reply_to?.enc
          ? { ...msg.reply_to, content: useChat.getState().messagesByChannel[dmId]?.find(m => m.id === msg.reply_to.id)?.content ?? null }
          : msg.reply_to
        addMessage({
          ...msg,
          // Chiffré : le serveur ne renvoie pas le texte, on garde celui saisi.
          content: msg.enc ? vars.content : msg.content,
          // Clés des fichiers envoyés : gardées pour afficher mes pièces jointes sans recharger.
          ...(msg.enc ? { e2e: 'ok', e2e_body: { t: vars.content ?? '', ...filesExtra(vars.files), ...vars.extra } } : {}),
          channel_id: dmId,
          author_id: me.id,
          author_username: me.username,
          author_avatar: me.avatar ?? null,
          author_discriminator: '0000',
          reply_to: msg.reply_to_id ?? null,
          reply_to_content: reply?.content ?? null,
          reply_to_username: reply?.sender_username ?? null,
          attachments: msg.attachments ?? [],
          reactions: msg.reactions ?? [],
          type: 'default',
          pinned: false,
          edited_at: null,
        })
        if (vars.files?.count && msg.id) {
          await postWithUploadProgress(`/dms/${dmId}/messages/${msg.id}/attachments`, vars.files.form, vars.files.bytes).catch(() => null)
        }
      }
    },
    onError: (e, vars) => {
      if (isQueued(e)) { toast(t('offline.queued')); return }
      toast.error(sendErrorText(e, t('dm.sendError')))
      // Restaurer le texte comme brouillon pour ne pas le perdre (pas le texte d'une carte de support)
      if (vars.content && dmId && !vars.extra) useDraft.getState().setDraft(dmId, vars.content)
    },
  })

  // Support à distance : les cartes et le bouton d'en-tête envoient par ce même chemin chiffré.
  const sendSupport = useCallback(
    (rs: SupportPayload) => sendDm.mutateAsync({ content: t(`rs.text.${rs.k}` as Key), extra: { rs } }).then(() => {}),
    [sendDm.mutateAsync, t],
  )
  useSupportSender(dmId, sendSupport)

  if (!dmId) return null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="fc-chat-header flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 min-h-[48px] transition-colors">
        <button
          className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label={t('dm.back')}
          title={t('dm.messages')}
        >
          <ChevronLeft size={20} />
        </button>
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden">
            {partnerAvatar
              ? <img src={mediaUrl(partnerAvatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : partnerName.charAt(0).toUpperCase()}
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLOR[status]}`} />
        </div>

        <div className="min-w-0">
          <div className="font-semibold text-white text-sm leading-none flex items-center gap-1.5">
            {partnerName}
          </div>
          <div className={`text-xs mt-0.5 flex items-center gap-1.5 min-w-0 ${status === 'online' ? 'text-fc-green' : 'text-fc-muted'}`}>
            <span className="flex-shrink-0">{t(STATUS_LABEL[status] ?? 'presence.offline')}</span>
            <RichStatus activity={partnerActivity} className="text-fc-muted" />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <E2EBadge kind="dm" id={dmId} />
          <DisappearingControl kind="dm" id={dmId} />
          <RemoteSupportButton dmId={dmId} autoOpen={searchParams.get('support') === '1'} />
          <button
            onClick={() => {
              if (isThisCallActive) { hangup(); return }
              if (callBusyElsewhere) { toast.error(t('dm.callBusy')); return }
              if (!partnerId || !dmId) { toast.error(t('dm.contactNotLoaded')); return }
              startCall(dmId, partnerId, 'voice').catch(() => toast.error(t('dm.micDenied')))
            }}
            disabled={(!partnerId && callState === 'idle') || callBusyElsewhere}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 rounded transition ${isThisCallActive && callType === 'voice' ? 'text-fc-green bg-green-900/30' : 'text-fc-muted hover:text-white hover:bg-fc-hover'} disabled:opacity-40`}
            title={isThisCallActive && callType === 'voice' ? t('dm.hangUp') : t('friends.call.voice')}
            aria-label={isThisCallActive && callType === 'voice' ? t('dm.hangUp') : t('dm.startVoice')}
          >
            <Phone size={18} />
          </button>
          <button
            onClick={() => {
              if (isThisCallActive) { hangup(); return }
              if (callBusyElsewhere) { toast.error(t('dm.callBusy')); return }
              if (!partnerId || !dmId) { toast.error(t('dm.contactNotLoaded')); return }
              startCall(dmId, partnerId, 'video').catch(() => toast.error(t('settings.video.denied')))
            }}
            disabled={(!partnerId && callState === 'idle') || callBusyElsewhere}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 rounded transition ${isThisCallActive && callType === 'video' ? 'text-fc-accent bg-indigo-900/30' : 'text-fc-muted hover:text-white hover:bg-fc-hover'} disabled:opacity-40`}
            title={isThisCallActive && callType === 'video' ? t('dm.endCall') : t('friends.call.video')}
            aria-label={isThisCallActive && callType === 'video' ? t('dm.endVideo') : t('dm.startVideo')}
          >
            <Video size={18} />
          </button>
          <button
            onClick={() => setShowSearch(s => !s)}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 rounded transition ${showSearch ? 'text-white bg-fc-hover' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}
            title={t('dm.search')}
            aria-label={t('dm.search')}
            aria-pressed={showSearch}
          >
            <Search size={18} />
          </button>
          <button
            onClick={() => setShowPins(p => !p)}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 rounded transition ${showPins ? 'text-white bg-fc-hover' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}
            title={t('dm.pins')}
            aria-label={t('dm.pins')}
            aria-pressed={showPins}
          >
            <Pin size={18} />
          </button>
        </div>
      </div>

      {/* Panneau d'appel DM vocal/vidéo — uniquement si l'appel actif est celui de CETTE
          conversation (isThisCallActive) ; s'il tourne ailleurs, aucune UI ici (la
          VoiceBar globale ou une future pastille flottante s'en charge) */}
      {isThisCallActive && (
        <div className={`flex flex-col items-center justify-center gap-4 p-6 border-b ${callType === 'video' ? 'border-fc-accent/40 bg-black' : 'border-green-600/40 bg-green-900/10'}`}>
          {callType === 'video' ? (
            <div className="relative w-full max-h-56 bg-black rounded-xl overflow-hidden flex items-center justify-center"
              onDoubleClick={remoteStream || remoteVideoUrl ? () => setVideoFullscreen(true) : undefined}
              title={remoteStream || remoteVideoUrl ? t('voice.tile.dblclickHint') : undefined}>
              {/* muted OBLIGATOIRE : PersistentDmCallAudio joue déjà ce même remoteStream
                  hors de cette page (pour que le son survive à la navigation). Sans ça, la
                  voix du correspondant sort deux fois — volume doublé et écho métallique
                  sur tout appel vidéo (défaut A5). Le son reste sur l'élément audio
                  persistant, comme pour VoiceVideoPage. */}
              {/* Application Linux : flux vidéo locaux fournis par le vocal natif. */}
              {remoteVideoUrl
                ? <NativeVideo url={remoteVideoUrl} fit="contain" className="w-full h-56" />
                : <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full max-h-56 object-contain" />}
              {localVideoUrl
                ? <NativeVideo url={localVideoUrl} fit="cover" className="absolute bottom-2 right-2 w-24 h-16 rounded-lg border border-white/20" />
                : <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-2 right-2 w-24 h-16 object-cover rounded-lg border border-white/20" />}
              {callState === 'connected' && (remoteStream || remoteVideoUrl) && (
                <span
                  className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-xs font-medium tabular-nums select-none"
                  aria-label={t('dm.callDuration', { d: callDuration })}
                >
                  {callDuration}
                </span>
              )}
              {(remoteStream || remoteVideoUrl) && (
                <button onClick={() => setVideoFullscreen(true)} aria-label={t('voice.tile.expandVideo')} title={t('voice.tile.expandVideo')}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white min-w-[32px] min-h-[32px] flex items-center justify-center">
                  <Maximize2 size={14} aria-hidden />
                </button>
              )}
              {videoFullscreen && (remoteStream || remoteVideoUrl) && (
                <FullscreenVideo stream={remoteStream} url={remoteVideoUrl} label={partnerName} onClose={() => setVideoFullscreen(false)} />
              )}
              {!remoteStream && !remoteVideoUrl && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
                  <div className="w-14 h-14 rounded-full bg-fc-accent flex items-center justify-center text-xl font-bold text-white overflow-hidden">
                    {partnerAvatar ? <img src={mediaUrl(partnerAvatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : partnerName.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-white font-semibold text-sm">{partnerName}</p>
                  <p className={`text-xs ${callState === 'connected' ? 'text-fc-green tabular-nums' : 'text-fc-muted animate-pulse'}`}>
                    {callState === 'calling' ? t('dm.calling') : callState === 'ringing' ? t('dm.connecting') : t('dm.connected', { d: callDuration })}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {/* Audio distant : PersistentDmCallAudio (global), pas un <audio> ici */}
              <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white overflow-hidden">
                {partnerAvatar ? <img src={mediaUrl(partnerAvatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : partnerName.charAt(0).toUpperCase()}
              </div>
              <p className="text-white font-semibold">{partnerName}</p>
              <p className={`text-sm ${callState === 'connected' ? 'text-fc-green tabular-nums' : 'text-fc-muted animate-pulse'}`} aria-label={callState === 'connected' ? t('dm.connectedLabel', { d: callDuration }) : undefined}>
                {callState === 'calling' ? t('dm.calling') : callState === 'ringing' ? t('dm.connecting') : `● ${t('dm.connected', { d: callDuration })}`}
              </p>
            </div>
          )}
          <E2ECallBadge encrypted={callE2ee} outdatedNames={e2eeOutdated.length ? [partnerName] : []} />
          <div className="flex items-center gap-3">
            {callType === 'video' && (
              <button
                onClick={toggleCam}
                className={`p-3 rounded-full transition ${camOff ? 'bg-fc-red text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
                title={camOff ? t('dm.camOn') : t('dm.camOff')}
                aria-label={camOff ? t('dm.camOnLabel') : t('dm.camOffLabel')}
                aria-pressed={!camOff}
              >
                {camOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
            )}
            <button
              onClick={toggleMic}
              className={`p-3 rounded-full transition ${micMuted ? 'bg-fc-red text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
              title={micMuted ? t('dm.micOn') : t('dm.micOff')}
              aria-label={micMuted ? t('dm.micOnLabel') : t('dm.micOffLabel')}
              aria-pressed={!micMuted}
            >
              {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button
              onClick={hangup}
              className="p-3 bg-fc-red rounded-full text-white hover:bg-red-600 transition"
              title={t('dm.hangUp')}
              aria-label={t('dm.hangUp')}
            >
              <PhoneOff size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Panneau de recherche DM */}
      {showSearch && dmId && (
        <div className="border-b border-fc-bg">
          <SearchPanel channelId={dmId} serverId="" channelName={t('dm.direct')} onClose={() => setShowSearch(false)}
            localMessages={encrypted ? (useChat.getState().messagesByChannel[dmId] ?? []) : undefined} />
        </div>
      )}

      {/* Panneau des messages épinglés */}
      {showPins && dmId && (
        <div className="border-b border-fc-bg bg-fc-channel">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-fc-bg">
            <div className="flex items-center gap-2">
              <Pin size={15} className="text-fc-accent" aria-hidden />
              <span className="font-semibold text-white text-sm">{t('dm.pins')} — {dmPins.length}</span>
            </div>
            <button
              onClick={() => setShowPins(false)}
              aria-label={t('dm.closePins')}
              className="p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto overscroll-contain p-3 space-y-2">
            {dmPins.length === 0 && (
              <p className="text-center text-fc-muted text-sm py-4">{t('dm.noPins')}<br />{t('dm.noPinsHint')}</p>
            )}
            {dmPins.map(pin => (
              <div key={pin.id} className="relative group/pin bg-fc-bg/50 rounded-lg p-2.5 border border-fc-hover/40 hover:border-fc-hover transition">
                <button
                  onClick={() => { setShowPins(false); nav(`/dms/${dmId}?highlight=${pin.message_id}`) }}
                  className="text-left w-full"
                  aria-label={t('dm.goToMessageOf', { name: pin.message.sender_name })}
                >
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-white">{pin.message.sender_name}</span>
                    <span className="text-[10px] text-fc-muted">{formatShort(pin.message.created_at)}</span>
                  </div>
                  <div className="text-xs text-fc-text leading-relaxed line-clamp-2">
                    {pin.message.content ?? t('common.attachment')}
                  </div>
                </button>
                <button
                  onClick={() => togglePin.mutate({ msgId: pin.message_id, pinned: true })}
                  aria-label={t('dm.unpin')}
                  title={t('dm.unpin')}
                  className="absolute top-1.5 right-1.5 p-1 rounded text-fc-muted hover:text-fc-red hover:bg-fc-hover transition opacity-100 md:opacity-0 md:group-hover/pin:opacity-100"
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {highlightMessageId && (
        <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-fc-accent/10 border-b border-fc-accent/20 flex-shrink-0">
          <span className="text-xs text-fc-accent">{t('dm.context')}</span>
          <button
            onClick={() => nav(`/dms/${dmId}`)}
            className="text-xs text-fc-accent hover:underline font-medium flex-shrink-0"
          >
            {t('channel.latest')}
          </button>
        </div>
      )}
      <DMConversation
        dmId={dmId}
        partnerName={partnerName}
        onSend={(content, replyTo, files) => void prepareFiles('dm', dmId!, files ?? []).then(
          prepared => sendDm.mutate({ content: content || null, replyTo, files: prepared }),
          e => toast.error(sendErrorText(e, t('dm.sendError'))),
        )}
        onLoadMore={loadMoreDM}
        initialHighlightId={highlightMessageId}
        loadError={dmMessagesError}
        onRetryLoad={() => refetchDmMessages()}
        onPinMessage={(msgId, pinned) => togglePin.mutate({ msgId, pinned })}
      />
    </div>
  )
}
