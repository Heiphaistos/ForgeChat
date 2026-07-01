import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from './store/auth'
import { useWs } from './store/ws'
import { useCallStore } from './store/call'
import { usePresence } from './store/presence'
import { useUnread } from './store/unread'
import { useVoice } from './store/voice'
import { useAudioNotifications } from './hooks/useAudioNotifications'
import { usePushNotifications, sendNativeNotification } from './hooks/usePushNotifications'
import { useQueryClient } from '@tanstack/react-query'
import { useChat } from './store/chat'
import { useChannelNotif } from './store/channelNotif'
import toast from 'react-hot-toast'

// Imports statiques pour le chemin critique (login/register sont légers)
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import MainLayout from './components/layout/MainLayout'

// Lazy loading pour les pages non-critiques au premier affichage
const LandingPage = lazy(() => import('./pages/LandingPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const FriendInvitePage = lazy(() => import('./pages/FriendInvitePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ChannelPage = lazy(() => import('./pages/ChannelPage'))
const DMPage = lazy(() => import('./pages/DMPage'))
const GroupDMPage = lazy(() => import('./pages/GroupDMPage'))
const FriendsPage = lazy(() => import('./pages/FriendsPage'))
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'))
const QuickSwitcher = lazy(() => import('./components/QuickSwitcher'))
const CommandPalette = lazy(() => import('./components/CommandPalette'))
const SavedPage = lazy(() => import('./pages/SavedPage'))
const ExplorePage = lazy(() => import('./pages/ExplorePage'))
const ServerDiscoveryPage = lazy(() => import('./pages/ServerDiscoveryPage'))
const ActivityFeedPage = lazy(() => import('./pages/ActivityFeedPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const TicketsPage = lazy(() => import('./pages/TicketsPage'))
const ServerAdminPage = lazy(() => import('./pages/ServerAdminPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const KeyboardShortcutsModal = lazy(() => import('./components/KeyboardShortcutsModal'))

const PageFallback = () => (
  <div className="flex items-center justify-center h-full w-full min-h-[200px]">
    <div className="w-7 h-7 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
  </div>
)

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-fc-bg">
      <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  return user ? <>{children}</> : <Navigate to="/login" replace />
}


function AppInner() {
  const { fetchMe, user, updateMe } = useAuth()
  const { connect, disconnect, on } = useWs()
  const setStatus = usePresence(s => s.setStatus)
  const setActivityGlobal = usePresence(s => s.setActivity)
  const { increment: incrUnread, fetchAll: fetchUnread } = useUnread()
  const initVoiceListeners = useVoice(s => s.initGlobalListeners)
  const updateUserInMessages = useChat(s => s.updateUserInMessages)
  const nav = useNavigate()
  const [showQuickSwitcher, setShowQuickSwitcher] = React.useState(false)
  const [showCommandPalette, setShowCommandPalette] = React.useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = React.useState(false)
  const [showOnboarding, setShowOnboarding] = React.useState(() => !localStorage.getItem('fc_onboarding_done'))
  const { playJoin, playLeave, playMessage, playMention, playRing } = useAudioNotifications()
  const { requestPermission } = usePushNotifications()
  const qcHook = useQueryClient()
  const { incomingCall, setIncomingCall, setPendingAccept } = useCallStore()

  useEffect(() => { fetchMe() }, [])

  // Appliquer le thème sauvegardé au démarrage
  useEffect(() => {
    const saved = localStorage.getItem('fc_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  // Appliquer le zoom sauvegardé au démarrage
  useEffect(() => {
    const zoom = localStorage.getItem('fc_zoom')
    if (zoom) document.documentElement.style.fontSize = `${zoom}%`
  }, [])

  // Ctrl+/- pour zoomer, Ctrl+0 pour reset
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        const cur = parseFloat(document.documentElement.style.fontSize || '100')
        const next = Math.min(cur + 10, 150)
        document.documentElement.style.fontSize = `${next}%`
        localStorage.setItem('fc_zoom', String(next))
      } else if (e.key === '-') {
        e.preventDefault()
        const cur = parseFloat(document.documentElement.style.fontSize || '100')
        const next = Math.max(cur - 10, 70)
        document.documentElement.style.fontSize = `${next}%`
        localStorage.setItem('fc_zoom', String(next))
      } else if (e.key === '0') {
        e.preventDefault()
        document.documentElement.style.fontSize = '100%'
        localStorage.setItem('fc_zoom', '100')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const fetchChannelNotif = useChannelNotif(s => s.fetch)
  const isChannelMuted = useChannelNotif(s => s.isMuted)
  const isServerMuted = useChannelNotif(s => s.isServerMuted)

  useEffect(() => {
    if (!user) return
    connect()
    fetchUnread()
    fetchChannelNotif()
    return () => disconnect()
  }, [user?.id])

  // Appliquer les préférences d'accessibilité et streamer mode au démarrage
  useEffect(() => {
    if (!user) return
    import('./api/client').then(({ default: api }) => {
      api.get('/user/settings').then((r: { data: { reduce_motion?: boolean; high_contrast?: boolean; streamer_mode?: boolean; interface_density?: string } }) => {
        const d = r.data ?? {}
        document.documentElement.setAttribute('data-reduce-motion', String(d.reduce_motion ?? false))
        document.documentElement.setAttribute('data-high-contrast', String(d.high_contrast ?? false))
        document.documentElement.setAttribute('data-streamer-mode', String(d.streamer_mode ?? false))
        const density = d.interface_density ?? 'normal'
        document.documentElement.setAttribute('data-density', density)
        localStorage.setItem('fc_density', density)
      }).catch(() => {})
    })
  }, [user?.id])

  // Listeners globaux voix (joins/leaves pour la sidebar)
  useEffect(() => {
    if (!user) return
    const off = initVoiceListeners()
    return off
  }, [user?.id])

  useEffect(() => {
    const offUpdate = on('PRESENCE_UPDATE', (d: any) => {
      if (d.user_id && d.status) setStatus(d.user_id, d.status)
      if (d.user_id) setActivityGlobal(d.user_id, {
        activity_type: d.activity_type,
        activity_name: d.activity_name,
        activity_detail: d.activity_detail,
      })
      // Mettre à jour le statut personnalisé de l'utilisateur courant
      if (d.user_id === user?.id) {
        const patch: Record<string, unknown> = {}
        if (d.custom_status !== undefined) patch.custom_status = d.custom_status
        if (d.custom_status_emoji !== undefined) patch.custom_status_emoji = d.custom_status_emoji
        if (Object.keys(patch).length > 0) updateMe(patch)
      }
    })
    // Snapshot de présence envoyé au moment de la connexion WS
    const offInit = on('PRESENCE_INIT', (d: any) => {
      if (!Array.isArray(d.users)) return
      for (const u of d.users) {
        if (u.user_id && u.status) setStatus(u.user_id, u.status)
        if (u.user_id) setActivityGlobal(u.user_id, {
          activity_type: u.activity_type,
          activity_name: u.activity_name,
          activity_detail: u.activity_detail,
        })
      }
    })
    return () => { offUpdate(); offInit() }
  }, [user?.id])

  // Incrémenter non-lus pour les messages reçus sur des canaux non actifs
  useEffect(() => {
    const off = on('MESSAGE_CREATE', (d: any) => {
      const msg = d.message
      if (!msg?.channel_id || msg?.author_id === user?.id) return
      const currentPath = window.location.pathname
      const activeChannelId = currentPath.match(/\/channels\/([^/]+)/)?.[1]
      if (activeChannelId !== msg.channel_id) {
        incrUnread(msg.channel_id, d.server_id ?? undefined)
      }
    })
    return off
  }, [user?.id])

  // Sons sur events vocaux et mentions
  useEffect(() => {
    if (!user) return
    const offJoin = on('VOICE_USER_JOINED', () => { if (!user.focus_mode) playJoin() })
    const offLeave = on('VOICE_USER_LEFT', () => { if (!user.focus_mode) playLeave() })
    const offMsg = on('MESSAGE_CREATE', (d: any) => {
      const msg = d.message
      if (!msg || msg.author_id === user.id) return
      if (user.focus_mode) return
      if (msg.channel_id && isChannelMuted(msg.channel_id)) return
      if (d.server_id && isServerMuted(d.server_id)) return
      const content: string = msg.content ?? ''
      const escapedName = user.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const mentionedMe = new RegExp(`@${escapedName}(?:[^a-zA-Z0-9_]|$)`).test(content)
      if (mentionedMe || content.includes('@everyone') || content.includes('@here')) {
        playMention()
        const goToMsg = () => d.server_id && d.message?.channel_id
          ? nav(`/servers/${d.server_id}/channels/${d.message.channel_id}?highlight=${msg.id}`)
          : undefined
        if (document.hasFocus()) {
          toast(`🔔 ${msg.author_username ?? 'Quelqu\'un'}: ${content.slice(0, 60)}`, {
            duration: 5000,
            style: { cursor: 'pointer', maxWidth: '360px' },
            onClick: goToMsg,
          } as any)
        } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          sendNativeNotification(msg.author_username ?? 'Quelqu\'un', {
            body: content.slice(0, 80),
            onClick: goToMsg,
          })
        } else {
          toast(`🔔 ${msg.author_username ?? 'Quelqu\'un'}: ${content.slice(0, 60)}`, {
            duration: 5000,
            style: { cursor: 'pointer', maxWidth: '360px' },
            onClick: goToMsg,
          } as any)
        }
      } else if (!document.hasFocus()) {
        playMessage()
      }
    })
    return () => { offJoin(); offLeave(); offMsg() }
  }, [user?.id, user?.focus_mode, isChannelMuted, isServerMuted, playJoin, playLeave, playMessage, playMention])

  // Demander permission notifications au login
  useEffect(() => {
    if (user) requestPermission()
  }, [user?.id])

  // Badge non-lus dans le titre de la page
  const allUnread = useUnread(s => s.counts)
  useEffect(() => {
    const total = Object.values(allUnread).reduce((sum: number, n) => sum + (n as number), 0)
    document.title = total > 0 ? `(${total}) ForgeChat` : 'ForgeChat'
  }, [allUnread])

  // Notifications temps réel pour les demandes d'ami
  useEffect(() => {
    if (!user) return
    const offReq = on('FRIEND_REQUEST', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['friends'] })
      toast(`👋 Nouvelle demande d'ami de ${d.from_username ?? 'quelqu\'un'}`, {
        duration: 5000,
        icon: '🤝',
      })
    })
    const offAcc = on('FRIEND_ACCEPTED', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['friends'] })
      toast.success(`${d.from_username ?? 'Quelqu\'un'} a accepté ta demande d'ami !`)
    })
    const offRemoved = on('FRIEND_REMOVED', () => {
      qcHook.invalidateQueries({ queryKey: ['friends'] })
    })
    const offGroupDm = on('GROUP_DM_CREATE', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['dms'] })
      if (d.group?.name) toast(`Groupe créé : ${d.group.name}`, { icon: '👥', duration: 5000 })
    })
    return () => { offReq(); offAcc(); offRemoved(); offGroupDm() }
  }, [user?.id])

  // Appels DM entrants
  useEffect(() => {
    if (!user) return
    const offIncoming = on('DM_CALL_INCOMING', (d: any) => {
      setIncomingCall({
        fromUserId: String(d.from),
        fromUsername: d.from_username ?? 'Utilisateur',
        dmId: String(d.dm_id),
        callType: d.call_type === 'video' ? 'video' : 'voice',
      })
      playRing()
    })
    const offEnded = on('DM_CALL_ENDED', () => setIncomingCall(null))
    const offDeclined = on('DM_CALL_DECLINED', () => setIncomingCall(null))
    const offCallError = on('DM_CALL_ERROR', (d: any) => {
      if (d.reason === 'offline') {
        toast('Votre contact est hors ligne', { icon: '📵', duration: 4000 })
      }
    })
    return () => { offIncoming(); offEnded(); offDeclined(); offCallError() }
  }, [user?.id, playRing])

  // Notifications push pour les messages privés
  useEffect(() => {
    if (!user) return
    const getDmMuted = (dmId: string): boolean => {
      const cache = qcHook.getQueryData<any[]>(['dms'])
      return cache?.find(dm => dm.id === dmId)?.is_muted ?? false
    }
    const offDm = on('DM_MESSAGE', (d: any) => {
      const msg = d.message
      if (!msg) return
      // Rafraîchir la liste DMs sidebar (dernier message + ordre) pour sender ET recipient
      qcHook.invalidateQueries({ queryKey: ['dms'] })
      if (msg.sender_id === user.id) return
      const currentPath = window.location.pathname
      const isActive = currentPath === `/dms/${d.dm_id}` && document.hasFocus()
      if (!isActive) {
        const isMuted = getDmMuted(d.dm_id)
        incrUnread(d.dm_id)
        if (isMuted) return
        if (!user.focus_mode) playMessage()
        if (document.hasFocus()) {
          // Fenêtre focusée mais sur une autre page → toast cliquable
          toast(`${msg.sender_username ?? 'Message privé'}: ${msg.content ? msg.content.slice(0, 60) : '📎 Pièce jointe'}`, {
            duration: 4000,
            style: { cursor: 'pointer', maxWidth: '320px' },
            onClick: () => nav(`/dms/${d.dm_id}`),
          } as any)
        } else {
          // Fenêtre non focusée → native, sinon toast de repli quand la fenêtre reprend le focus
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            sendNativeNotification(msg.sender_username ?? 'Message privé', {
              body: msg.content ? msg.content.slice(0, 100) : '📎 Pièce jointe',
              onClick: () => nav(`/dms/${d.dm_id}`),
            })
          } else {
            toast(`💬 ${msg.sender_username ?? 'Message privé'}: ${msg.content ? msg.content.slice(0, 60) : '📎 Pièce jointe'}`, {
              duration: 5000,
              style: { cursor: 'pointer', maxWidth: '320px' },
              onClick: () => nav(`/dms/${d.dm_id}`),
            } as any)
          }
        }
      }
    })
    const offGroupMsg = on('GROUP_DM_MESSAGE', (d: any) => {
      const msg = d.message
      if (!msg) return
      qcHook.invalidateQueries({ queryKey: ['dms'] })
      if (msg.sender_id === user.id) return
      const currentPath = window.location.pathname
      const isActive = currentPath === `/dms/groups/${d.group_id}` && document.hasFocus()
      if (!isActive) {
        incrUnread(d.group_id)
        const isGroupMuted = qcHook.getQueryData<any[]>(['dms'])?.find(dm => dm.id === d.group_id)?.is_muted ?? false
        const content: string = msg.content ?? ''
        const escapedName = user.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const mentionedMe = !user.focus_mode && (
          new RegExp(`@${escapedName}(?:[^a-zA-Z0-9_]|$)`).test(content) ||
          content.includes('@everyone')
        )
        if (isGroupMuted) return
        if (!user.focus_mode) {
          if (mentionedMe) playMention()
          else playMessage()
        }
        const goTo = () => nav(`/dms/groups/${d.group_id}`)
        const preview = content ? content.slice(0, 60) : '📎 Pièce jointe'
        if (document.hasFocus()) {
          toast(`${msg.sender_username ?? 'Groupe'}: ${preview}`, {
            duration: mentionedMe ? 7000 : 4000,
            style: { cursor: 'pointer', maxWidth: '320px' },
            onClick: goTo,
          } as any)
        } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          sendNativeNotification(msg.sender_username ?? 'Groupe', {
            body: content ? content.slice(0, 100) : '📎 Pièce jointe',
            onClick: goTo,
          })
        } else {
          toast(`👥 ${msg.sender_username ?? 'Groupe'}: ${preview}`, {
            duration: mentionedMe ? 7000 : 5000,
            style: { cursor: 'pointer', maxWidth: '320px' },
            onClick: goTo,
          } as any)
        }
      }
    })
    return () => { offDm(); offGroupMsg() }
  }, [user?.id, user?.focus_mode, playMessage, playMention])

  // Mise à jour temps réel des canaux et serveur
  useEffect(() => {
    if (!user) return
    const offUpdate = on('CHANNEL_UPDATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offCreate = on('CHANNEL_CREATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offDelete = on('CHANNEL_DELETE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offServerUpdate = on('SERVER_UPDATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['servers'] })
      }
    })
    const offEmojiCreate = on('EMOJI_CREATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['emojis', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['custom_emojis', d.server_id] })
      }
    })
    const offEmojiDelete = on('EMOJI_DELETE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['emojis', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['custom_emojis', d.server_id] })
      }
    })
    const offEmojiUpdate = on('EMOJI_UPDATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['emojis', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['custom_emojis', d.server_id] })
      }
    })
    const offCategoryCreate = on('CATEGORY_CREATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offPermUpdate = on('CHANNEL_PERMISSION_UPDATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
      if (d.channel_id) qcHook.invalidateQueries({ queryKey: ['channel-permissions', d.channel_id] })
    })
    const offArchive = on('CHANNEL_ARCHIVE_UPDATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offMemberJoin = on('MEMBER_JOIN', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
      }
    })
    const offMemberLeave = on('MEMBER_LEAVE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
      }
    })
    const offMemberKicked = on('MEMBER_KICKED', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
    })
    const offMemberBanned = on('MEMBER_BANNED', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
    })
    return () => {
      offUpdate(); offCreate(); offDelete(); offServerUpdate()
      offEmojiCreate(); offEmojiDelete(); offEmojiUpdate(); offCategoryCreate()
      offPermUpdate(); offArchive(); offMemberJoin(); offMemberLeave(); offMemberKicked(); offMemberBanned()
    }
  }, [user?.id])

  // Timeout utilisateur reçu en temps réel
  useEffect(() => {
    if (!user) return
    const offTimeout = on('USER_TIMEOUT', (d: any) => {
      toast.error(`Vous avez été mis en sourdine jusqu'à ${new Date(d.expires_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${d.reason ? ` — ${d.reason}` : ''}`, { duration: 8000 })
    })
    const offLift = on('USER_TIMEOUT_LIFTED', () => {
      toast.success('Votre timeout a été levé', { duration: 4000 })
    })
    return () => { offTimeout(); offLift() }
  }, [user?.id])

  // Rappels programmés
  useEffect(() => {
    if (!user) return
    const offReminder = on('REMINDER', (d: any) => {
      toast(d.content ?? 'Rappel !', { icon: '⏰', duration: 10000 })
    })
    const offReorder = on('CHANNELS_REORDER', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    return () => { offReminder(); offReorder() }
  }, [user?.id])

  // Mise à jour profil utilisateur → sync temps réel dans tous les messages
  useEffect(() => {
    if (!user) return
    const offUserUpdate = on('USER_UPDATE', (d: any) => {
      const u = d.user
      if (!u?.id) return
      updateUserInMessages(u.id, u.username, u.avatar ?? null)
      qcHook.invalidateQueries({ queryKey: ['members'] })
    })
    const offBoost = on('SERVER_BOOST', (d: any) => {
      toast.success(`${d.username ?? 'Un membre'} a boosté le serveur !`, { duration: 5000, icon: '🚀' })
    })
    const offTagAssign = on('MEMBER_TAG_ASSIGN', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['members_detailed', d.server_id] })
    })
    const offTagRemove = on('MEMBER_TAG_REMOVE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['members_detailed', d.server_id] })
    })
    const offServerTagCreate = on('SERVER_TAG_CREATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['tags', d.server_id] })
    })
    const offServerTagDelete = on('SERVER_TAG_DELETE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['tags', d.server_id] })
    })
    const offMemberTimeout = on('MEMBER_TIMEOUT', (d: any) => {
      if (d.user_id && d.user_id !== user.id) {
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
      }
    })
    const offMemberTimeoutLifted = on('MEMBER_TIMEOUT_LIFTED', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
    })
    const offRoleCreate = on('ROLE_CREATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offRoleDelete = on('ROLE_DELETE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offRoleUpdate = on('ROLE_UPDATE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    const offMemberRoleUpdate = on('MEMBER_ROLE_UPDATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members_detailed', d.server_id] })
      }
    })
    return () => {
      offUserUpdate(); offBoost(); offTagAssign(); offTagRemove()
      offMemberTimeout(); offMemberTimeoutLifted(); offRoleCreate(); offRoleDelete(); offRoleUpdate(); offMemberRoleUpdate()
      offServerTagCreate(); offServerTagDelete()
    }
  }, [user?.id])

  // Expulsion/ban → forcer le retour à l'accueil + refresh liste serveurs
  useEffect(() => {
    if (!user) return
    const offKicked = on('MEMBER_KICKED', (d: any) => {
      toast.error('Vous avez été expulsé du serveur', { duration: 6000 })
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['servers'] })
        qcHook.removeQueries({ queryKey: ['server', d.server_id] })
        qcHook.removeQueries({ queryKey: ['members', d.server_id] })
      }
      nav('/')
    })
    const offBanned = on('MEMBER_BANNED', (d: any) => {
      toast.error('Vous avez été banni du serveur', { duration: 6000 })
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['servers'] })
        qcHook.removeQueries({ queryKey: ['server', d.server_id] })
        qcHook.removeQueries({ queryKey: ['members', d.server_id] })
        qcHook.removeQueries({ queryKey: ['bans', d.server_id] })
      }
      nav('/')
    })
    const offServerDelete = on('SERVER_DELETE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['servers'] })
        qcHook.removeQueries({ queryKey: ['server', d.server_id] })
      }
      nav('/')
    })
    const offRemove = on('MEMBER_REMOVE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
      }
    })
    const offLeave = on('MEMBER_LEAVE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
      }
    })
    const offUnban = on('MEMBER_UNBAN', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['bans', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
      }
    })
    return () => { offKicked(); offBanned(); offServerDelete(); offRemove(); offLeave(); offUnban() }
  }, [user?.id])

  // Raccourcis clavier globaux
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(q => !q)
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        setShowQuickSwitcher(q => !q)
      }
      if (e.key === 'Escape') {
        setShowQuickSwitcher(false)
        setShowCommandPalette(false)
        setShowKeyboardShortcuts(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        nav('/settings')
      }
      if (e.key === '?' && !isInput && !e.ctrlKey && !e.metaKey) {
        setShowKeyboardShortcuts(q => !q)
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        useUnread.getState().markAllRead()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [nav])

  return (
    <>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/invite/:code" element={<InvitePage />} />
          <Route path="/friend-invite/:code" element={<FriendInvitePage />} />
          <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
          <Route path="/" element={<HomeRoute />} />
          <Route element={<AuthGuard><MainLayout /></AuthGuard>}>
            <Route path="friends" element={<FriendsPage />} />
            <Route path="users/:userId" element={<UserProfilePage />} />
            <Route path="saved" element={<SavedPage />} />
            <Route path="explore" element={<ExplorePage />} />
            <Route path="discovery" element={<ServerDiscoveryPage />} />
            <Route path="activity" element={<ActivityFeedPage />} />
            <Route path="dms/:dmId" element={<DMPage />} />
            <Route path="dms/groups/:groupId" element={<GroupDMPage />} />
            <Route path="servers/:serverId" element={<ChannelPage />} />
            <Route path="servers/:serverId/channels/:channelId" element={<ChannelPage />} />
            <Route path="servers/:serverId/leaderboard" element={<LeaderboardPage />} />
            <Route path="servers/:serverId/tickets" element={<TicketsPage />} />
            <Route path="servers/:serverId/admin" element={<ServerAdminPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Routes>
        {showQuickSwitcher && <QuickSwitcher onClose={() => setShowQuickSwitcher(false)} />}
        <CommandPalette isOpen={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
        {showKeyboardShortcuts && <KeyboardShortcutsModal onClose={() => setShowKeyboardShortcuts(false)} />}
        {showOnboarding && user && <Onboarding onDone={() => setShowOnboarding(false)} />}
      </Suspense>
      {incomingCall && (
        <IncomingCallModal
          call={incomingCall}
          onAccept={() => {
            setPendingAccept({ fromUserId: incomingCall.fromUserId, callType: incomingCall.callType })
            setIncomingCall(null)
            nav(`/dms/${incomingCall.dmId}`)
          }}
          onDecline={() => {
            const { send } = useWs.getState()
            send({ type: 'DM_CALL_DECLINE', to: incomingCall.fromUserId, dm_id: incomingCall.dmId })
            setIncomingCall(null)
          }}
        />
      )}
    </>
  )
}

import React from 'react'
import Onboarding from './components/Onboarding'
import ErrorBoundary from './components/ErrorBoundary'
import { Phone, Video, PhoneOff } from 'lucide-react'
import type { IncomingCallInfo } from './store/call'

function IncomingCallModal({ call, onAccept, onDecline }: {
  call: IncomingCallInfo
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] bg-fc-channel border border-fc-hover rounded-2xl shadow-2xl p-5 w-80 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-fc-accent flex items-center justify-center text-lg font-bold text-white flex-shrink-0">
          {call.fromUsername.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-white font-semibold text-sm">{call.fromUsername}</p>
          <p className="text-fc-muted text-xs flex items-center gap-1">
            {call.callType === 'video' ? <Video size={11} /> : <Phone size={11} />}
            {call.callType === 'video' ? 'Appel vidéo entrant...' : 'Appel vocal entrant...'}
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onDecline}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-fc-red hover:bg-red-600 rounded-xl text-white text-sm font-medium transition"
        >
          <PhoneOff size={16} />
          Refuser
        </button>
        <button
          onClick={onAccept}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-fc-green hover:bg-green-600 rounded-xl text-white text-sm font-medium transition"
        >
          {call.callType === 'video' ? <Video size={16} /> : <Phone size={16} />}
          Accepter
        </button>
      </div>
    </div>
  )
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function HomeRoute() {
  const { user, loading } = useAuth()
  if (!isTauri) return <LandingPage />
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-fc-bg">
      <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  return <Navigate to={user ? '/friends' : '/login'} replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
