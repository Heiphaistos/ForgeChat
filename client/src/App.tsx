import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from './store/auth'
import { useWs } from './store/ws'
import { usePresence } from './store/presence'
import { useUnread } from './store/unread'
import { useVoice } from './store/voice'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import InvitePage from './pages/InvitePage'
import FriendInvitePage from './pages/FriendInvitePage'
import SettingsPage from './pages/SettingsPage'
import MainLayout from './components/layout/MainLayout'
import ChannelPage from './pages/ChannelPage'
import DMPage from './pages/DMPage'
import GroupDMPage from './pages/GroupDMPage'
import FriendsPage from './pages/FriendsPage'
import UserProfilePage from './pages/UserProfilePage'
import QuickSwitcher from './components/QuickSwitcher'
import CommandPalette from './components/CommandPalette'
import SavedPage from './pages/SavedPage'
import ExplorePage from './pages/ExplorePage'
import ServerDiscoveryPage from './pages/ServerDiscoveryPage'
import ActivityFeedPage from './pages/ActivityFeedPage'
import LeaderboardPage from './pages/LeaderboardPage'
import TicketsPage from './pages/TicketsPage'
import ServerAdminPage from './pages/ServerAdminPage'
import AdminPage from './pages/AdminPage'
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal'
import { useAudioNotifications } from './hooks/useAudioNotifications'
import { usePushNotifications, sendNativeNotification } from './hooks/usePushNotifications'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import LandingPage from './pages/LandingPage'

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
  const nav = useNavigate()
  const [showQuickSwitcher, setShowQuickSwitcher] = React.useState(false)
  const [showCommandPalette, setShowCommandPalette] = React.useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = React.useState(false)
  const [showOnboarding, setShowOnboarding] = React.useState(() => !localStorage.getItem('fc_onboarding_done'))
  const { playJoin, playLeave, playMessage, playMention } = useAudioNotifications()
  const { requestPermission } = usePushNotifications()
  const qcHook = useQueryClient()

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

  useEffect(() => {
    if (!user) return
    connect()
    fetchUnread()
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
    const off = on('PRESENCE_UPDATE', (d: any) => {
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
    return off
  }, [user?.id])

  // Incrémenter non-lus pour les messages reçus sur des canaux non actifs
  useEffect(() => {
    const off = on('MESSAGE_CREATE', (d: any) => {
      const msg = d.message
      if (!msg?.channel_id || msg?.author_id === user?.id) return
      const currentPath = window.location.pathname
      if (!currentPath.includes(msg.channel_id)) {
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
      const content: string = msg.content ?? ''
      if (content.includes(`@${user.username}`) || content.includes('@everyone') || content.includes('@here')) {
        playMention()
        sendNativeNotification(msg.author_username ?? 'Quelqu\'un', { body: content.slice(0, 80) })
      } else if (!document.hasFocus()) {
        playMessage()
      }
    })
    return () => { offJoin(); offLeave(); offMsg() }
  }, [user?.id, user?.focus_mode, playJoin, playLeave, playMessage, playMention])

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
    const offGroupDm = on('GROUP_DM_CREATE', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['dms'] })
      if (d.group?.name) toast(`Groupe créé : ${d.group.name}`, { icon: '👥', duration: 5000 })
    })
    return () => { offReq(); offAcc(); offGroupDm() }
  }, [user?.id])

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
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['emojis', d.server_id] })
    })
    const offEmojiDelete = on('EMOJI_DELETE', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['emojis', d.server_id] })
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
    return () => { offUpdate(); offCreate(); offDelete(); offServerUpdate(); offEmojiCreate(); offEmojiDelete(); offPermUpdate(); offArchive(); offMemberJoin() }
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
      toast(d.message ?? 'Rappel !', { icon: '⏰', duration: 10000 })
    })
    const offReorder = on('CHANNELS_REORDER', (d: any) => {
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
    })
    return () => { offReminder(); offReorder() }
  }, [user?.id])

  // Expulsion/ban → forcer le retour à l'accueil + refresh liste serveurs
  useEffect(() => {
    if (!user) return
    const offKicked = on('MEMBER_KICKED', (d: any) => {
      toast.error('Vous avez été expulsé du serveur', { duration: 6000 })
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['servers'] })
      nav('/')
    })
    const offBanned = on('MEMBER_BANNED', (d: any) => {
      toast.error('Vous avez été banni du serveur', { duration: 6000 })
      if (d.server_id) qcHook.invalidateQueries({ queryKey: ['servers'] })
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
    return () => { offKicked(); offBanned(); offRemove(); offLeave() }
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
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [nav])

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="/friend-invite/:code" element={<FriendInvitePage />} />
        <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
        <Route path="/" element={<LandingPage />} />
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
    </>
  )
}

import React from 'react'
import Onboarding from './components/Onboarding'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
