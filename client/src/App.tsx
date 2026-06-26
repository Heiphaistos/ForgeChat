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
import FriendsPage from './pages/FriendsPage'
import UserProfilePage from './pages/UserProfilePage'
import QuickSwitcher from './components/QuickSwitcher'
import CommandPalette from './components/CommandPalette'
import SavedPage from './pages/SavedPage'
import ExplorePage from './pages/ExplorePage'
import ServerDiscoveryPage from './pages/ServerDiscoveryPage'
import ActivityFeedPage from './pages/ActivityFeedPage'
import LeaderboardPage from './pages/LeaderboardPage'
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
  const { fetchMe, user } = useAuth()
  const { connect, disconnect, on } = useWs()
  const setStatus = usePresence(s => s.setStatus)
  const setActivityGlobal = usePresence(s => s.setActivity)
  const { increment: incrUnread, fetchAll: fetchUnread } = useUnread()
  const initVoiceListeners = useVoice(s => s.initGlobalListeners)
  const nav = useNavigate()
  const [showQuickSwitcher, setShowQuickSwitcher] = React.useState(false)
  const [showCommandPalette, setShowCommandPalette] = React.useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = React.useState(false)
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
    })
    return off
  }, [])

  // Incrémenter non-lus pour les messages reçus sur des canaux non actifs
  useEffect(() => {
    const off = on('MESSAGE_CREATE', (d: any) => {
      const msg = d.message
      if (!msg?.channel_id || msg?.author_id === user?.id) return
      const currentPath = window.location.pathname
      if (!currentPath.includes(msg.channel_id)) {
        incrUnread(msg.channel_id)
      }
    })
    return off
  }, [user?.id])

  // Sons sur events vocaux et mentions
  useEffect(() => {
    if (!user) return
    const offJoin = on('VOICE_USER_JOINED', () => playJoin())
    const offLeave = on('VOICE_USER_LEFT', () => playLeave())
    const offMsg = on('MESSAGE_CREATE', (d: any) => {
      const msg = d.message
      if (!msg || msg.author_id === user.id) return
      const content: string = msg.content ?? ''
      if (content.includes(`@${user.username}`) || content.includes('@everyone') || content.includes('@here')) {
        playMention()
        sendNativeNotification(msg.author_username ?? 'Quelqu\'un', { body: content.slice(0, 80) })
      } else if (!document.hasFocus()) {
        playMessage()
      }
    })
    return () => { offJoin(); offLeave(); offMsg() }
  }, [user?.id, playJoin, playLeave, playMessage, playMention])

  // Demander permission notifications au login
  useEffect(() => {
    if (user) requestPermission()
  }, [user?.id])

  // Notifications temps réel pour les demandes d'ami
  useEffect(() => {
    if (!user) return
    const offReq = on('FRIEND_REQUEST', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['friends-v2'] })
      toast(`👋 Nouvelle demande d'ami de ${d.from_username ?? 'quelqu\'un'}`, {
        duration: 5000,
        icon: '🤝',
      })
    })
    const offAcc = on('FRIEND_ACCEPTED', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['friends-v2'] })
      toast.success(`${d.from_username ?? 'Quelqu\'un'} a accepté ta demande d'ami !`)
    })
    return () => { offReq(); offAcc() }
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
          <Route path="servers/:serverId" element={<ChannelPage />} />
          <Route path="servers/:serverId/channels/:channelId" element={<ChannelPage />} />
          <Route path="servers/:serverId/leaderboard" element={<LeaderboardPage />} />
        </Route>
      </Routes>
      {showQuickSwitcher && <QuickSwitcher onClose={() => setShowQuickSwitcher(false)} />}
      <CommandPalette isOpen={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
      {showKeyboardShortcuts && <KeyboardShortcutsModal onClose={() => setShowKeyboardShortcuts(false)} />}
    </>
  )
}

import React from 'react'

export default function App() {

  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}
