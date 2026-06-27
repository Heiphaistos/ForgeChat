import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Phone, Video, Search, Lock, LockOpen, Mic, MicOff, PhoneOff, VideoOff } from 'lucide-react'
import api from '../api/client'
import { useChat } from '../store/chat'
import { useWs } from '../store/ws'
import { usePresence } from '../store/presence'
import { useAuth } from '../store/auth'
import { useUnread } from '../store/unread'
import { useE2E } from '../hooks/useE2E'
import { useDmCall } from '../hooks/useDmCall'
import { useCallStore } from '../store/call'
import DMConversation from '../components/chat/DMConversation'
import SearchPanel from '../components/chat/SearchPanel'
import toast from 'react-hot-toast'

const STATUS_LABEL: Record<string, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas déranger',
  invisible: 'Invisible',
  offline: 'Hors ligne',
}

const STATUS_COLOR: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

interface E2eMsg {
  id: string
  content: string
  sender_id: string
  sender_username: string
  sender_avatar: string | null
  created_at: string
}

export default function DMPage() {
  const { dmId } = useParams<{ dmId: string }>()
  const { addMessages, addMessage } = useChat()
  const { on } = useWs()
  const getStatus = usePresence(s => s.getStatus)
  const me = useAuth(s => s.user)
  const resetUnread = useUnread(s => s.reset)
  const { generateAndStoreKeyPair, getSharedKey, encrypt, decrypt } = useE2E()


  const [e2eMode, setE2eMode] = useState(false)
  const [e2eMessages, setE2eMessages] = useState<E2eMsg[]>([])
  const [e2eInput, setE2eInput] = useState('')
  const [e2eSending, setE2eSending] = useState(false)
  const e2eBottomRef = useRef<HTMLDivElement>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [hasMoreDM, setHasMoreDM] = useState(true)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  const loadMoreDM = useCallback(async (): Promise<boolean> => {
    if (!dmId || !hasMoreDM) return false
    const msgs = useChat.getState().messagesByChannel[dmId] ?? []
    if (msgs.length === 0) return false
    const oldestId = msgs[0].id
    try {
      const { data } = await api.get(`/dms/${dmId}/messages?before=${oldestId}&limit=50`)
      if (data.length === 0) { setHasMoreDM(false); return false }
      const normalized = data.map((m: any) => ({
        ...m,
        channel_id: dmId,
        author_id: m.sender_id,
        author_username: m.sender_username,
        author_avatar: m.sender_avatar,
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
    } catch { return false }
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
  const status = partnerId ? getStatus(partnerId) : 'offline'

  const {
    callState, callType, localStream, remoteStream, micMuted, camOff,
    startCall, acceptCall, hangup, toggleMic, toggleCam,
  } = useDmCall(dmId, partnerId || undefined)

  const { pendingAccept, setPendingAccept } = useCallStore()

  // Auto-accept call if navigated here from incoming call modal
  useEffect(() => {
    if (pendingAccept && dmId && partnerId) {
      const { fromUserId, callType: ct } = pendingAccept
      setPendingAccept(null)
      acceptCall(fromUserId, ct)
    }
  }, [pendingAccept, dmId, partnerId])

  // Attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  const { data: messages = [] } = useQuery({
    queryKey: ['dm_messages', dmId],
    queryFn: () => api.get(`/dms/${dmId}/messages`).then(r => r.data),
    enabled: !!dmId && !e2eMode,
  })

  const { data: rawE2eMessages = [] } = useQuery({
    queryKey: ['e2e_messages', dmId],
    queryFn: () => api.get(`/dms/${dmId}/e2e`).then(r => r.data),
    enabled: !!dmId && e2eMode,
  })

  // Populate chat store with normal messages
  useEffect(() => {
    if (messages.length > 0 && dmId) {
      const normalized = messages.map((m: any) => ({
        ...m,
        channel_id: dmId,
        author_id: m.sender_id,
        author_username: m.sender_username,
        author_avatar: m.sender_avatar,
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

  // Decrypt E2E messages when they arrive
  useEffect(() => {
    if (!e2eMode || !partnerId || rawE2eMessages.length === 0) return
    let cancelled = false

    async function decryptAll() {
      const key = await getSharedKey(partnerId)
      if (!key || cancelled) return

      const decrypted = await Promise.all(
        rawE2eMessages.map(async (msg: any) => {
          try {
            const content = await decrypt(msg.ciphertext, key)
            return {
              id: msg.id,
              content,
              sender_id: msg.sender_id,
              sender_username: msg.sender_username ?? partnerName,
              sender_avatar: msg.sender_avatar ?? null,
              created_at: msg.created_at,
            } as E2eMsg
          } catch {
            return {
              id: msg.id,
              content: '🔒 [impossible à déchiffrer]',
              sender_id: msg.sender_id,
              sender_username: msg.sender_username ?? partnerName,
              sender_avatar: msg.sender_avatar ?? null,
              created_at: msg.created_at,
            } as E2eMsg
          }
        })
      )

      if (!cancelled) setE2eMessages(decrypted)
    }

    decryptAll()
    return () => { cancelled = true }
  }, [rawE2eMessages, e2eMode, partnerId])

  // Auto-scroll to bottom when new E2E messages arrive
  useEffect(() => {
    if (e2eMode) e2eBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [e2eMessages, e2eMode])

  // Reset pagination quand on change de conversation
  useEffect(() => { setHasMoreDM(true) }, [dmId])

  // Effacer le badge non-lu quand on ouvre ou focus le DM
  useEffect(() => {
    if (!dmId) return
    const markRead = () => resetUnread(dmId)
    markRead()
    window.addEventListener('focus', markRead)
    return () => window.removeEventListener('focus', markRead)
  }, [dmId])

  // Normal DM WebSocket listener
  useEffect(() => {
    if (!dmId || e2eMode) return
    const off = on('DM_MESSAGE', (d: any) => {
      if (d.dm_id === dmId) {
        addMessage({
          ...d.message,
          channel_id: dmId,
          author_id: d.message.sender_id,
          author_username: d.message.sender_username ?? 'Utilisateur',
          author_avatar: d.message.sender_avatar ?? null,
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
    return off
  }, [dmId, e2eMode])

  // E2E WebSocket listener (incoming encrypted messages from partner)
  useEffect(() => {
    if (!dmId || !e2eMode) return
    const off = on('DM_E2E_MESSAGE', async (d: any) => {
      if (d.dm_id !== dmId) return
      const key = await getSharedKey(d.message.sender_id)
      if (!key) return
      try {
        const content = await decrypt(d.message.ciphertext, key)
        setE2eMessages(prev => [...prev, {
          id: d.message.id,
          content,
          sender_id: d.message.sender_id,
          sender_username: d.message.sender_username ?? partnerName,
          sender_avatar: d.message.sender_avatar ?? null,
          created_at: d.message.created_at,
        }])
      } catch {
        toast.error('Message E2E impossible à déchiffrer')
      }
    })
    return off
  }, [dmId, e2eMode, partnerId])

  // Normal DM mutation (non-E2E)
  const sendDm = useMutation({
    mutationFn: ({ content, replyTo, files }: { content: string | null; replyTo?: string; files?: import('../components/chat/MessageInput').FileWithTtl[] }) =>
      api.post(`/dms/${dmId}/messages`, {
        content: content ?? '',
        reply_to: replyTo,
        has_attachments: !!files?.length,
      }),
    onSuccess: async (res, vars) => {
      const msg = res.data
      if (msg && me && dmId) {
        addMessage({
          ...msg,
          channel_id: dmId,
          author_id: me.id,
          author_username: me.username,
          author_avatar: me.avatar ?? null,
          author_discriminator: '0000',
          reply_to: msg.reply_to_id ?? null,
          reply_to_content: msg.reply_to?.content ?? null,
          reply_to_username: msg.reply_to?.sender_username ?? null,
          attachments: msg.attachments ?? [],
          reactions: msg.reactions ?? [],
          type: 'default',
          pinned: false,
          edited_at: null,
        })
        if (vars.files && vars.files.length > 0 && msg.id) {
          const fd = new FormData()
          for (const fw of vars.files) {
            fd.append('files', fw.file)
            if (fw.ttlHours != null) fd.append('ttl_hours', String(fw.ttlHours))
          }
          await api.post(`/dms/${dmId}/messages/${msg.id}/attachments`, fd).catch(() => null)
        }
      }
    },
    onError: () => toast.error('Envoi impossible'),
  })

  // Toggle E2E mode — generate keypair if needed, verify partner has one
  const toggleE2e = useCallback(async () => {
    if (e2eMode) {
      setE2eMode(false)
      setE2eMessages([])
      return
    }
    if (!partnerId) {
      toast.error('Conversation non chargée, réessayez')
      return
    }
    try {
      await generateAndStoreKeyPair()
      const key = await getSharedKey(partnerId)
      if (!key) {
        toast.error(`${partnerName} n'a pas encore activé le chiffrement E2E`)
        return
      }
      setE2eMode(true)
      toast.success('Chiffrement E2E activé 🔒', { icon: '🔐' })
    } catch {
      toast.error('Impossible d\'activer le chiffrement E2E')
    }
  }, [e2eMode, partnerId, partnerName, generateAndStoreKeyPair, getSharedKey])

  // Send an E2E-encrypted message
  const sendE2e = useCallback(async () => {
    if (!e2eInput.trim() || !partnerId || e2eSending) return
    setE2eSending(true)
    const plaintext = e2eInput.trim()
    try {
      const key = await getSharedKey(partnerId)
      if (!key) throw new Error('Clé non disponible')
      const ciphertext = await encrypt(plaintext, key)
      const { data } = await api.post(`/dms/${dmId}/e2e`, { ciphertext })
      // Optimistic add — server does not echo back to sender
      setE2eMessages(prev => [...prev, {
        id: data.id ?? crypto.randomUUID(),
        content: plaintext,
        sender_id: data.sender_id ?? me?.id ?? '',
        sender_username: data.sender_username ?? me?.username ?? 'Moi',
        sender_avatar: data.sender_avatar ?? me?.avatar ?? null,
        created_at: data.created_at ?? new Date().toISOString(),
      }])
      setE2eInput('')
    } catch {
      toast.error('Envoi E2E impossible')
    } finally {
      setE2eSending(false)
    }
  }, [e2eInput, partnerId, e2eSending, encrypt, getSharedKey, dmId, me])

  if (!dmId) return null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b shadow-sm flex-shrink-0 min-h-[48px] transition-colors ${
        e2eMode ? 'border-green-600/40 bg-green-900/10' : 'border-fc-bg'
      }`}>
        <div className="md:hidden w-8 flex-shrink-0" />
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden">
            {partnerAvatar
              ? <img src={partnerAvatar} alt="" className="w-full h-full object-cover" />
              : partnerName.charAt(0).toUpperCase()}
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLOR[status]}`} />
        </div>

        <div>
          <div className="font-semibold text-white text-sm leading-none flex items-center gap-1.5">
            {partnerName}
            {e2eMode && (
              <span className="text-green-400 text-[10px] font-normal bg-green-900/40 px-1.5 py-0.5 rounded">
                E2E chiffré
              </span>
            )}
          </div>
          <div className={`text-xs mt-0.5 ${status === 'online' ? 'text-fc-green' : 'text-fc-muted'}`}>
            {STATUS_LABEL[status] ?? 'Hors ligne'}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={toggleE2e}
            title={e2eMode ? 'Désactiver le chiffrement E2E' : 'Activer le chiffrement E2E (ECDH P-256 + AES-GCM)'}
            className={`p-1.5 rounded transition ${
              e2eMode
                ? 'text-green-400 bg-green-900/30 hover:bg-green-900/50 hover:text-green-300'
                : 'text-fc-muted hover:text-white hover:bg-fc-hover'
            }`}
          >
            {e2eMode ? <Lock size={18} /> : <LockOpen size={18} />}
          </button>
          <button
            onClick={() => {
              if (callState !== 'idle') { hangup(); return }
              startCall('voice').catch(() => toast.error('Accès au micro refusé'))
            }}
            className={`p-1.5 rounded transition ${callState !== 'idle' && callType === 'voice' ? 'text-fc-green bg-green-900/30' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}
            title={callState !== 'idle' && callType === 'voice' ? 'Raccrocher' : 'Appel vocal'}
          >
            <Phone size={18} />
          </button>
          <button
            onClick={() => {
              if (callState !== 'idle') { hangup(); return }
              startCall('video').catch(() => toast.error('Accès caméra refusé'))
            }}
            className={`p-1.5 rounded transition ${callState !== 'idle' && callType === 'video' ? 'text-fc-accent bg-indigo-900/30' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}
            title={callState !== 'idle' && callType === 'video' ? 'Terminer l\'appel' : 'Appel vidéo'}
          >
            <Video size={18} />
          </button>
          <button
            onClick={() => setShowSearch(s => !s)}
            className={`p-1.5 rounded transition ${showSearch ? 'text-white bg-fc-hover' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}
            title="Rechercher dans la conversation"
          >
            <Search size={18} />
          </button>
        </div>
      </div>

      {/* Panneau d'appel DM vocal/vidéo */}
      {callState !== 'idle' && (
        <div className={`flex flex-col items-center justify-center gap-4 p-6 border-b ${callType === 'video' ? 'border-fc-accent/40 bg-black' : 'border-green-600/40 bg-green-900/10'}`}>
          {callType === 'video' ? (
            <div className="relative w-full max-h-56 bg-black rounded-xl overflow-hidden flex items-center justify-center">
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full max-h-56 object-contain" />
              <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-2 right-2 w-24 h-16 object-cover rounded-lg border border-white/20" />
              {!remoteStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
                  <div className="w-14 h-14 rounded-full bg-fc-accent flex items-center justify-center text-xl font-bold text-white overflow-hidden">
                    {partnerAvatar ? <img src={partnerAvatar} alt="" className="w-full h-full object-cover" /> : partnerName.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-white font-semibold text-sm">{partnerName}</p>
                  <p className="text-xs text-fc-muted animate-pulse">
                    {callState === 'calling' ? 'Appel en cours...' : callState === 'ringing' ? 'Connexion...' : 'Connecté'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white overflow-hidden">
                {partnerAvatar ? <img src={partnerAvatar} alt="" className="w-full h-full object-cover" /> : partnerName.charAt(0).toUpperCase()}
              </div>
              <p className="text-white font-semibold">{partnerName}</p>
              <p className={`text-sm ${callState === 'connected' ? 'text-fc-green' : 'text-fc-muted animate-pulse'}`}>
                {callState === 'calling' ? 'Appel en cours...' : callState === 'ringing' ? 'Connexion...' : '● Connecté'}
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            {callType === 'video' && (
              <button
                onClick={toggleCam}
                className={`p-3 rounded-full transition ${camOff ? 'bg-fc-red text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
                title={camOff ? 'Activer caméra' : 'Désactiver caméra'}
              >
                {camOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
            )}
            <button
              onClick={toggleMic}
              className={`p-3 rounded-full transition ${micMuted ? 'bg-fc-red text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
              title={micMuted ? 'Activer micro' : 'Couper micro'}
            >
              {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
            <button
              onClick={hangup}
              className="p-3 bg-fc-red rounded-full text-white hover:bg-red-600 transition"
              title="Raccrocher"
            >
              <PhoneOff size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Panneau de recherche DM */}
      {showSearch && dmId && (
        <div className="border-b border-fc-bg">
          <SearchPanel channelId={dmId} serverId="" channelName="Messages directs" onClose={() => setShowSearch(false)} />
        </div>
      )}

      {/* E2E mode: custom encrypted chat area */}
      {e2eMode ? (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {e2eMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-fc-muted gap-3 pt-12">
                <Lock size={40} className="text-green-500/60" />
                <p className="text-sm font-medium text-green-400">Conversation chiffrée de bout en bout</p>
                <p className="text-xs text-center max-w-xs">
                  Les messages sont chiffrés avec ECDH P-256 + AES-GCM 256-bit.<br/>
                  Le serveur ne peut pas lire leur contenu.
                </p>
              </div>
            ) : (
              e2eMessages.map(msg => (
                <div key={msg.id} className="flex items-start gap-2.5 group">
                  <div className="w-8 h-8 rounded-full bg-fc-accent flex-shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                    {msg.sender_avatar
                      ? <img src={msg.sender_avatar} alt="" className="w-full h-full object-cover" />
                      : msg.sender_username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-white">{msg.sender_username}</span>
                      <span className="text-xs text-fc-muted">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <Lock size={9} className="text-green-500/70 mb-0.5" />
                    </div>
                    <p className="text-sm text-fc-text mt-0.5 break-words leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))
            )}
            <div ref={e2eBottomRef} />
          </div>

          {/* E2E input */}
          <div className="px-4 pb-4 flex-shrink-0">
            <div className="flex items-center gap-2 bg-fc-input rounded-lg px-3 py-2.5 border border-green-600/30 focus-within:border-green-500/60 transition-colors">
              <Lock size={14} className="text-green-500 flex-shrink-0" />
              <input
                autoFocus
                className="flex-1 bg-transparent text-sm text-fc-text outline-none placeholder:text-fc-muted"
                placeholder={`Message chiffré à @${partnerName}`}
                value={e2eInput}
                onChange={e => setE2eInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendE2e()
                  }
                }}
                disabled={e2eSending}
              />
              <button
                onClick={sendE2e}
                disabled={!e2eInput.trim() || e2eSending}
                className="text-xs px-2.5 py-1 rounded-md bg-green-700 hover:bg-green-600 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {e2eSending ? '…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <DMConversation
          dmId={dmId}
          partnerName={partnerName}
          onSend={(content, replyTo, files) => sendDm.mutate({ content: content || null, replyTo, files })}
          onLoadMore={loadMoreDM}
        />
      )}
    </div>
  )
}
