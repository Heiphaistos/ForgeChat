import { useEffect, useState, useRef, useCallback, lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './store/auth'
import E2EGate from './e2e/E2EGate'
import KeyChangeDialog from './e2e/KeyChangeDialog'
import KeyTransparencyMonitor from './e2e/KeyTransparencyMonitor'
import type { EncPayload } from './e2e/crypto'
import { openText } from './e2e/conversations'
import { channelPreview } from './e2e/channels'
import { useWs } from './store/ws'
import { useCommunityRealtime } from './components/community/useCommunityRealtime'
import { useCallStore } from './store/call'
import { useGroupCall } from './store/groupCall'
import { GroupCallRinger } from './components/voice/GroupCallPanel'
import { usePresence } from './store/presence'
import { useUnread } from './store/unread'
import { useVoice } from './store/voice'
import { useAudioNotifications } from './hooks/useAudioNotifications'
import { usePushNotifications, sendNativeNotification } from './hooks/usePushNotifications'
import { useThreadNotifications } from './hooks/useThreadNotifications'
import { useForumPostNotifications } from './hooks/useForumPostNotifications'
import { useUpdateNotifier } from './hooks/useUpdateNotifier'
import { useGlobalShortcuts } from './hooks/useShortcuts'
import api from './api/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useChat } from './store/chat'
import { useChannelNotif } from './store/channelNotif'
import toast from 'react-hot-toast'
import { stripMarkdown } from './utils/mdShortcuts'
import { mentionsToText } from './utils/mentions'
import { syncWebPush } from './utils/webPush'

import { useThemeStore, asDensity } from './theme/themeStore'
import { fontStack } from './theme/fonts'

// Imports statiques pour le chemin critique
import MainLayout from './components/layout/MainLayout'
import PersistentVoiceAudio from './components/voice/PersistentVoiceAudio'
import PersistentDmCallAudio from './components/voice/PersistentDmCallAudio'
import UserVolumePopover from './components/voice/UserVolumePopover'
import UserMenuHost from './components/userMenu/UserMenuHost'
import { isIgnored } from './store/uxPrefs'
import FloatingCallPiP from './components/voice/FloatingCallPiP'
import VoiceHotkeys from './components/voice/VoiceHotkeys'
import AppLockOverlay from './components/AppLockOverlay'
import { setOfflineOwner } from './lib/offline'
import { sendOutbox } from './lib/outboxSend'
import { startAfkWatch } from './store/afk'
import { useGameActivity } from './hooks/useGameActivity'

// Lazy loading pour les pages non-critiques au premier affichage
const AccueilPage = lazy(() => import('./pages/site/SitePages').then(m => ({ default: m.AccueilPage })))
const FonctionnalitesPage = lazy(() => import('./pages/site/SitePages').then(m => ({ default: m.FonctionnalitesPage })))
const NouveautesPage = lazy(() => import('./pages/site/SitePages').then(m => ({ default: m.NouveautesPage })))
const AidePage = lazy(() => import('./pages/site/SitePages').then(m => ({ default: m.AidePage })))
const AProposPage = lazy(() => import('./pages/site/SitePages').then(m => ({ default: m.AProposPage })))
const TelechargerPage = lazy(() => import('./pages/site/TelechargerPage'))
const TelechargerPlateformePage = lazy(() => import('./pages/site/TelechargerPage').then(m => ({ default: m.TelechargerPlateformePage })))
// Login/Register embarquent Logo3D (three.js, vendor-three ~150KB gzip) --
// plus "légers" depuis son ajout, donc plus question de les charger en eager.
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const MentionsLegalesPage = lazy(() => import('./pages/LegalPages').then(m => ({ default: m.MentionsLegalesPage })))
const ConfidentialitePage = lazy(() => import('./pages/LegalPages').then(m => ({ default: m.ConfidentialitePage })))
const CguPage = lazy(() => import('./pages/LegalPages').then(m => ({ default: m.CguPage })))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const PasswordResetPage = lazy(() => import('./pages/PasswordResetPage'))
const LockAccountPage = lazy(() => import('./pages/LockAccountPage'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const BackupViewerPage = lazy(() => import('./pages/BackupViewerPage'))
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
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const NewsPage = lazy(() => import('./pages/NewsPage'))
const ScheduledPage = lazy(() => import('./pages/ScheduledPage'))
const ExplorePage = lazy(() => import('./pages/ExplorePage'))
const ServerDiscoveryPage = lazy(() => import('./pages/ServerDiscoveryPage'))
const ActivityFeedPage = lazy(() => import('./pages/ActivityFeedPage'))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'))
const TicketsPage = lazy(() => import('./pages/TicketsPage'))
const ServerAdminPage = lazy(() => import('./pages/ServerAdminPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const DiagnosticsAdminPage = lazy(() => import('./pages/DiagnosticsAdminPage'))
const DmReportsAdminPage = lazy(() => import('./pages/DmReportsAdminPage'))
const SiteAdminPage = lazy(() => import('./pages/SiteAdminPage'))
const ImportDiscordPage = lazy(() => import('./pages/ImportDiscordPage'))
const KeyboardShortcutsModal = lazy(() => import('./components/KeyboardShortcutsModal'))

const PageFallback = () => (
  <div className="flex items-center justify-center h-full w-full min-h-[200px]">
    <div className="w-7 h-7 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
  </div>
)

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-fc-bg">
      <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (user) return <>{children}</>
  // Garder la destination (ex. lien profond /import-discord?src=…) pour y revenir après connexion
  const redirect = location.pathname + location.search
  return <Navigate to={redirect === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`} replace />
}


// L'utilisateur a ce salon / ce MP sous les yeux : onglet visible, fenêtre au
// premier plan, route correspondante. Sert à marquer lu en continu (P1-6) et à
// ne pas notifier un message qu'il est en train de lire.
function isViewing(channelId: string): boolean {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return false
  const path = window.location.pathname
  return path.includes(`/channels/${channelId}`) || path === `/dms/${channelId}` || path === `/dms/groups/${channelId}`
}

// Messages déjà signalés par MENTION_CREATE (reçu juste avant MESSAGE_CREATE) :
// MESSAGE_CREATE ne doit pas les notifier une seconde fois.
const mentionedMessageIds = new Set<string>()

interface MentionEvent {
  message_id: string
  channel_id: string
  server_id: string
  channel_name: string
  author_username: string
  /** Null pour un message chiffré (`enc`) : déchiffré pour l'aperçu. */
  content: string | null
  enc?: EncPayload | null
  client_msg_id?: string | null
  author_id?: string
}

function AppInner() {
  const { fetchMe, user, updateMe } = useAuth()
  const { connect, disconnect, on, onOpen } = useWs()
  useUpdateNotifier()
  const wsConnected = useWs(s => s.connected)
  const setStatus = usePresence(s => s.setStatus)
  const setActivityGlobal = usePresence(s => s.setActivity)
  const { increment: incrUnread, fetchAll: fetchUnread } = useUnread()
  const initVoiceListeners = useVoice(s => s.initGlobalListeners)
  const initDmCallListeners = useCallStore(s => s.initGlobalListeners)
  const initGroupCallListeners = useGroupCall(s => s.initGlobalListeners)
  const updateUserInMessages = useChat(s => s.updateUserInMessages)
  const nav = useNavigate()
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('fc_onboarding_done'))
  const { playJoin, playLeave, playMessage, playMention, playRing } = useAudioNotifications()
  const { requestPermission } = usePushNotifications()
  useThreadNotifications()
  useForumPostNotifications()
  // Compte suspendu ou déconnecté de force par un administrateur : retour à l'écran de connexion.
  useEffect(() => {
    const end = (message: string) => () => {
      toast.error(message)
      void useAuth.getState().logout().finally(() => { window.location.href = '/login' })
    }
    const offBan = on('ACCOUNT_BANNED', end('Ton compte a été suspendu.'))
    const offOut = on('FORCE_LOGOUT', end('Tu as été déconnecté par un administrateur.'))
    return () => { offBan(); offOut() }
  }, [on])
  const qcHook = useQueryClient()
  // Peuple le cache ['user-settings'] dès le montage (pas seulement quand l'utilisateur
  // ouvre Paramètres) -- nécessaire pour que sendNativeNotification puisse lire
  // quiet_hours_* de façon synchrone dès la 1re notification de la session.
  const { data: userSettings } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  // La langue du compte prime sur celle mémorisée localement (écran de connexion)
  const setLang = useLang(s => s.setLang)
  const accountLang: string | undefined = userSettings?.language
  useEffect(() => { if (accountLang) setLang(accountLang) }, [accountLang, setLang])
  const { incomingCall, setIncomingCall, setPendingAccept } = useCallStore()
  const pendingNotifs = useRef<Array<{ title: string; body: string; path: string }>>([])
  const wasConnected = useRef(false)
  if (wsConnected) wasConnected.current = true
  const showDisconnectBanner = !wsConnected && wasConnected.current && !!user

  // Flush queued notifications as toasts when window regains focus
  useEffect(() => {
    const onFocus = () => {
      const notifs = pendingNotifs.current.splice(0)
      if (notifs.length === 0) return
      if (notifs.length === 1) {
        const n = notifs[0]
        toast(`${n.body.startsWith('🔔') ? '' : '💬 '}${n.title}: ${n.body}`, {
          duration: 6000,
          style: { cursor: 'pointer', maxWidth: '320px' },
          onClick: () => nav(n.path),
        } as any)
      } else {
        // Group by unique senders
        const senders = [...new Set(notifs.map(n => n.title))]
        const label = senders.length <= 2
          ? senders.join(' & ')
          : tr('toast.othersCount', { names: senders.slice(0, 2).join(', '), n: senders.length - 2 })
        toast(tr('toast.messagesFrom', { n: notifs.length, from: label }), {
          duration: 6000,
          style: { cursor: 'pointer', maxWidth: '360px' },
          // Naviguer vers la conversation la plus récente (le curseur pointer le suggérait déjà)
          onClick: () => nav(notifs[notifs.length - 1].path),
        } as any)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => { fetchMe() }, [])

  // Thème, thèmes perso et disposition du compte (choisis sur un autre appareil) :
  // le thème local est déjà appliqué au chargement de theme/themeStore.
  useEffect(() => {
    if (!user) return
    useThemeStore.getState().loadRemote().catch(() => {})
  }, [user])

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
  const effectiveNotifLevel = useChannelNotif(s => s.effectiveLevel)

  useEffect(() => {
    if (!user) return
    connect()
    fetchUnread()
    fetchChannelNotif()
    return () => disconnect()
  }, [user?.id])

  // Re-fetch unread counts on every WS reconnect (catches messages missed during disconnect)
  useEffect(() => {
    if (!user) return
    return onOpen(() => { fetchUnread() })
  }, [user?.id, onOpen, fetchUnread])

  // Hors ligne : données gardées pour ce compte ; file d'envoi vidée au retour du réseau.
  useEffect(() => {
    if (!user) return
    setOfflineOwner(user.id)
    const flush = () => { void sendOutbox() }
    flush()
    window.addEventListener('online', flush)
    const offOpen = onOpen(flush)
    return () => { window.removeEventListener('online', flush); offOpen() }
  }, [user?.id, onOpen])

  // Forcer reconnexion WS immédiate quand l'onglet redevient visible
  // (évite le backoff excessif si le navigateur a suspendu la connexion)
  useEffect(() => {
    if (!user) return
    const handler = () => {
      if (document.visibilityState === 'visible') {
        const { socket, _reconnectTimeout } = useWs.getState()
        const isDisconnected = !socket || socket.readyState === WebSocket.CLOSED
        if (isDisconnected) {
          if (_reconnectTimeout) clearTimeout(_reconnectTimeout)
          useWs.setState({ _reconnectAttempts: 0, _reconnectTimeout: null })
          useWs.getState().connect()
        }
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [user?.id])

  // Appliquer les préférences au démarrage (a11y, apparence, streamer mode)
  useEffect(() => {
    if (!user) return
    import('./api/client').then(({ default: api }) => {
      api.get('/user/settings').then((r: { data: Record<string, unknown> }) => {
        const d = r.data ?? {}
        const root = document.documentElement

        // Accessibilité & modes
        root.setAttribute('data-reduce-motion', String(d.reduce_motion ?? false))
        root.setAttribute('data-high-contrast', String(d.high_contrast ?? false))
        root.setAttribute('data-streamer-mode', String(d.streamer_mode ?? false))

        // Densité
        useThemeStore.getState().setDensity(asDensity(d.interface_density))

        // Typographie (polices connues uniquement)
        root.style.setProperty('--fc-font-family', fontStack(d.font_family))
        const fontSize = typeof d.font_size_px === 'number' ? d.font_size_px : 14
        root.style.setProperty('--fc-font-size', `${fontSize}px`)

        // Accent du compte (remplace celui des thèmes prédéfinis, partagé avec le mobile)
        useThemeStore.getState().setAccent(typeof d.accent_color === 'string' ? d.accent_color : null)

        root.setAttribute('data-avatar-shape', (d.avatar_shape as string | undefined) ?? 'round')

        // Largeur sidebar — sync vers localStorage uniquement si pas déjà forcée par l'utilisateur
        if (typeof d.sidebar_width_px === 'number' && !localStorage.getItem('fc_sidebar_width'))
          localStorage.setItem('fc_sidebar_width', String(d.sidebar_width_px))
      }).catch(() => {})
    })
  }, [user?.id])

  // Activité « Joue à … » détectée par l'app de bureau.
  useGameActivity(!!user)
  // Mode streamer allumé tout seul quand OBS & co tournent (bureau, si activé dans les réglages).
  useStreamerAuto(!!user)

  // Rappel d'anniversaire d'un ami (birthdays.rs, une fois par an).
  useEffect(() => on('BIRTHDAY_TODAY', (d) => {
    const name = (d as { name?: unknown }).name
    if (typeof name === 'string') toast(tr('soc.bday.toast', { name }), { duration: 8000 })
  }), [on])

  // Listeners globaux voix (joins/leaves pour la sidebar)
  useEffect(() => {
    if (!user) return
    const off = initVoiceListeners()
    startAfkWatch()
    return off
  }, [user?.id])

  // Listeners globaux appel DM (signalisation WebRTC) — enregistrés une seule fois ici,
  // plus par DMPage à chaque montage, pour que l'appel survive à la navigation
  useEffect(() => {
    if (!user) return
    const off = initDmCallListeners()
    const offGroup = initGroupCallListeners()
    return () => { off(); offGroup() }
  }, [user?.id])

  useEffect(() => {
    const offUpdate = on('PRESENCE_UPDATE', (d: any) => {
      if (d.user_id && d.status) setStatus(d.user_id, d.status)
      // Un changement de statut personnalisé ne porte pas l'activité : ne pas l'effacer.
      if (d.user_id && 'activity_type' in d) setActivityGlobal(d.user_id, {
        activity_type: d.activity_type,
        activity_name: d.activity_name,
        activity_detail: d.activity_detail,
        in_call: d.in_call === true,
      })
      // Mettre à jour le statut personnalisé de l'utilisateur courant
      if (d.user_id === user?.id) {
        const patch: Record<string, unknown> = {}
        if (d.custom_status !== undefined) patch.custom_status = d.custom_status
        if (d.custom_status_emoji !== undefined) patch.custom_status_emoji = d.custom_status_emoji
        if (d.custom_status_expires_at !== undefined) patch.custom_status_expires_at = d.custom_status_expires_at
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
          in_call: u.in_call === true,
        })
      }
    })
    return () => { offUpdate(); offInit() }
  }, [user?.id])

  // Non-lus : un message du salon qu'on regarde est marqué lu tout de suite
  // (anti-rebond, par message_id) pour que les autres appareils le sachent ;
  // sinon il incrémente le compteur (fenêtre en arrière-plan comprise).
  useEffect(() => {
    const off = on('MESSAGE_CREATE', (d: any) => {
      const msg = d.message
      if (!msg?.channel_id || msg?.author_id === user?.id) return
      if (isViewing(msg.channel_id)) {
        useUnread.getState().markReadSoon(`/channels/${msg.channel_id}/read`, msg.channel_id, d.server_id ?? undefined, msg.id)
      } else {
        incrUnread(msg.channel_id, d.server_id ?? undefined)
      }
    })
    return off
  }, [user?.id])

  // Alerte visible : toast si la fenêtre est au premier plan, notification
  // système sinon, ou file d'attente affichée au retour du focus.
  const alertUser = useCallback((title: string, text: string, path: string, icon: string) => {
    const clean = stripMarkdown(mentionsToText(text))
    if (document.hasFocus()) {
      toast(`${icon} ${title}: ${clean.slice(0, 60)}`, {
        duration: 5000,
        style: { cursor: 'pointer', maxWidth: '360px' },
        onClick: () => nav(path),
      } as any)
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      sendNativeNotification(title, { body: clean.slice(0, 80), onClick: () => nav(path) })
    } else {
      pendingNotifs.current.push({ title, body: `${icon} ${clean.slice(0, 60)}`, path })
    }
  }, [nav])

  // Mentions (résolues côté serveur) et synchronisation des lectures entre appareils
  useEffect(() => {
    if (!user) return
    const offMention = on('MENTION_CREATE', async (raw) => {
      const d = raw as { notify?: boolean; mention?: MentionEvent }
      if (!d.mention) return
      mentionedMessageIds.add(d.mention.message_id)
      setTimeout(() => mentionedMessageIds.delete(d.mention!.message_id), 60_000)
      if (isViewing(d.mention.channel_id)) return
      // Salon chiffré : aperçu déchiffré sur l'appareil.
      const m = { ...d.mention, content: await channelPreview(d.mention) }
      useUnread.getState().addMention(m.channel_id, m.server_id)
      qcHook.setQueryData<MentionEvent[]>(['user_mentions'], old =>
        [m, ...(old ?? []).filter(x => x.message_id !== m.message_id)].slice(0, 50))
      if (!d.notify || useAuth.getState().user?.focus_mode) return
      playMention()
      alertUser(m.author_username ?? 'Mention', m.content ?? '',
        `/servers/${m.server_id}/channels/${m.channel_id}?highlight=${m.message_id}`, '🔔')
    })
    const offRead = on('READ_STATE_UPDATE', (raw) => {
      const d = raw as { all?: boolean; whole_server?: boolean; channel_id?: string; server_id?: string | null }
      const u = useUnread.getState()
      const keep = (pred: (m: MentionEvent) => boolean) =>
        qcHook.setQueryData<MentionEvent[]>(['user_mentions'], old => old?.filter(pred))
      if (d.all) {
        u.clearAll()
        qcHook.setQueryData(['user_mentions'], [])
      } else if (d.whole_server && d.server_id) {
        u.resetServer(d.server_id)
        keep(m => m.server_id !== d.server_id)
      } else if (d.channel_id) {
        u.reset(d.channel_id, d.server_id ?? undefined)
        keep(m => m.channel_id !== d.channel_id)
      }
    })
    return () => { offMention(); offRead() }
  }, [user?.id, playMention, alertUser])

  // Typing global — alimente useChat.typing pour TOUS les canaux/DMs/groupes
  // afin que la sidebar puisse afficher un indicateur "écrit..." (les pages
  // gèrent en plus leur propre indicateur local pour le canal ouvert)
  useEffect(() => {
    if (!user) return
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const track = (key: string, uid: string, username: string) => {
      if (!key || !uid || uid === user.id) return
      useChat.getState().setTyping(key, uid, username)
      const tk = `${key}:${uid}`
      const old = timers.get(tk)
      if (old) clearTimeout(old)
      timers.set(tk, setTimeout(() => {
        timers.delete(tk)
        useChat.getState().clearTyping(key, uid)
      }, 5000))
    }
    const offCh = on('TYPING_START', (d: any) => track(d.channel_id, d.user_id, d.username ?? 'Utilisateur'))
    const offDm = on('TYPING', (d: any) => track(d.conversation_id, d.user_id, d.username ?? 'Utilisateur'))
    return () => { offCh(); offDm(); timers.forEach(t => clearTimeout(t)) }
  }, [user?.id])

  // Sons sur events vocaux et mentions
  useEffect(() => {
    if (!user) return
    const offJoin = on('VOICE_USER_JOINED', () => { if (!user.focus_mode) playJoin() })
    const offLeave = on('VOICE_USER_LEFT', (d: any) => { if (!user.focus_mode && d.user_id !== user.id) playLeave() })
    // Les mentions et réponses sont notifiées par MENTION_CREATE (règle serveur).
    // Ici : seulement les salons au niveau « Tous les messages », hors sourdine.
    const offMsg = on('MESSAGE_CREATE', async (d: any) => {
      const msg = d.message
      if (!msg?.channel_id || !d.server_id || msg.author_id === user.id || user.focus_mode || isIgnored(msg.author_id)) return
      if (mentionedMessageIds.has(msg.id) || isViewing(msg.channel_id)) return
      if (isChannelMuted(msg.channel_id) || isServerMuted(d.server_id)) return
      if (effectiveNotifLevel(msg.channel_id, d.server_id) !== 'all') return
      if (!document.hasFocus()) playMessage()
      alertUser(msg.author_username ?? 'Message', await channelPreview(msg),
        `/servers/${d.server_id}/channels/${msg.channel_id}?highlight=${msg.id}`, '💬')
    })
    return () => { offJoin(); offLeave(); offMsg() }
  }, [user?.id, user?.focus_mode, isChannelMuted, isServerMuted, effectiveNotifLevel, playJoin, playLeave, playMessage, alertUser])

  // Absence automatique : chaque onglet/appareil signale son inactivité au
  // serveur (10 min sans activité), qui n'affiche « Absent » que si TOUTES les
  // sessions sont inactives. Le statut choisi (dnd, invisible) n'est jamais
  // modifié : avant, un onglet oublié passait tout le compte en « absent ».
  useEffect(() => {
    if (!user) return
    const IDLE_AFTER = 10 * 60_000
    let timer: ReturnType<typeof setTimeout> | undefined
    let idle = false
    const report = (next: boolean) => {
      if (idle === next) return
      idle = next
      useWs.getState().send({ type: 'PRESENCE_IDLE', idle: next })
    }
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => report(true), IDLE_AFTER) }
    const onActivity = () => { report(false); arm() }
    // Nouvelle connexion WS = nouvelle session côté serveur, réputée active.
    const offOpen = useWs.getState().onOpen(() => { idle = false; arm() })
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'mousedown', 'touchstart']
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))
    arm()
    return () => { clearTimeout(timer); offOpen(); events.forEach(ev => window.removeEventListener(ev, onActivity)) }
  }, [user?.id])

  // Demander permission notifications au login ; rattacher l'abonnement Web Push
  // éventuel de ce navigateur au compte connecté
  useEffect(() => {
    if (!user) return
    requestPermission()
    syncWebPush()
  }, [user?.id])

  // Badge non-lus dans le titre de la page (hors serveurs muets)
  const allUnread = useUnread(s => s.counts)
  const allServerCounts = useUnread(s => s.serverCounts)
  useEffect(() => {
    const allTotal = Object.values(allUnread).reduce((sum, n) => sum + n, 0)
    const serverTotal = Object.values(allServerCounts).reduce((sum, n) => sum + n, 0)
    const dmTotal = Math.max(0, allTotal - serverTotal)
    const unmutedServerTotal = Object.entries(allServerCounts)
      .filter(([svId]) => !isServerMuted(svId))
      .reduce((sum, [, n]) => sum + n, 0)
    const total = dmTotal + unmutedServerTotal
    const base = document.title.replace(/^\(\d+\)\s*/, '')
    document.title = total > 0 ? `(${total}) ${base}` : base
    // Badging API — pastille sur l'icône de la PWA installée (Android/desktop)
    const n = navigator as Navigator & { setAppBadge?: (c: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (total > 0) n.setAppBadge?.(total)?.catch(() => {})
    else n.clearAppBadge?.()?.catch(() => {})
  }, [allUnread, allServerCounts, isServerMuted])

  // Recharger tout ce qui a pu être manqué pendant une coupure/gel de connexion
  const resyncAfterGap = useCallback(() => {
    qcHook.invalidateQueries({ queryKey: ['messages'] })
    qcHook.invalidateQueries({ queryKey: ['dm_messages'] })
    qcHook.invalidateQueries({ queryKey: ['dms'] })
    qcHook.invalidateQueries({ queryKey: ['user_mentions'] })
    qcHook.invalidateQueries({ queryKey: ['server'] })
    useUnread.getState().fetchAll()
  }, [qcHook])

  // Resync après une coupure WebSocket : recharger ce qui a pu être manqué
  // (les events MESSAGE_CREATE perdus pendant la coupure ne seront jamais rejoués)
  const wasDisconnected = useRef(false)
  useEffect(() => {
    if (!wsConnected) { wasDisconnected.current = true; return }
    if (!wasDisconnected.current) return
    wasDisconnected.current = false
    resyncAfterGap()
  }, [wsConnected, resyncAfterGap])

  // Resync après un background prolongé (>60s) même si le socket semble OPEN :
  // les OS mobiles gèlent le WebSocket sans le fermer, les events sont perdus
  // silencieusement et le cas "reconnexion" ne se déclenche jamais
  const hiddenAt = useRef<number | null>(null)
  useEffect(() => {
    if (!user) return
    const handler = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return }
      const gap = hiddenAt.current ? Date.now() - hiddenAt.current : 0
      hiddenAt.current = null
      const { socket } = useWs.getState()
      const socketOpen = socket && socket.readyState === WebSocket.OPEN
      if (gap > 60_000 && socketOpen) resyncAfterGap()
      // Socket fermé : la reconnexion (autre handler) déclenchera le resync via wsConnected
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [user?.id, resyncAfterGap])

  // Notifications temps réel pour les demandes d'ami
  useEffect(() => {
    if (!user) return
    const offReq = on('FRIEND_REQUEST', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['friends'] })
      toast(tr('toast.friendRequest', { name: d.from_username ?? tr('toast.someone') }), {
        duration: 5000,
        icon: '🤝',
      })
    })
    const offAcc = on('FRIEND_ACCEPTED', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['friends'] })
      toast.success(tr('toast.friendAccepted', { name: d.from_username ?? tr('toast.Someone') }))
    })
    const offRemoved = on('FRIEND_REMOVED', () => {
      qcHook.invalidateQueries({ queryKey: ['friends'] })
    })
    const offGroupDm = on('GROUP_DM_CREATE', (d: any) => {
      qcHook.invalidateQueries({ queryKey: ['dms'] })
      if (d.group?.name) toast(tr('toast.groupCreated', { name: d.group.name }), { icon: '👥', duration: 5000 })
    })
    return () => { offReq(); offAcc(); offRemoved(); offGroupDm() }
  }, [user?.id])

  // Appels DM entrants
  useEffect(() => {
    if (!user) return
    const offIncoming = on('DM_CALL_INCOMING', (d: any) => {
      const fromUsername = d.from_username ?? 'Utilisateur'
      const callType = d.call_type === 'video' ? 'video' : 'voice'
      setIncomingCall({
        fromUserId: String(d.from),
        fromUsername,
        dmId: String(d.dm_id),
        callType,
      })
      playRing()
      // Fenêtre en arrière-plan : notification native (sinon l'appel est invisible)
      if (!document.hasFocus() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        sendNativeNotification(`${callType === 'video' ? '📹' : '📞'} Appel ${callType === 'video' ? 'vidéo' : 'vocal'} entrant`, {
          body: `${fromUsername} t'appelle`,
          onClick: () => nav(`/dms/${d.dm_id}`),
        })
      }
    })
    // Seulement l'appel qui sonne ici : la fin d'un AUTRE appel (celui en cours,
    // un autre correspondant) effaçait la sonnerie d'un appel entrant sans rapport.
    const isRinging = (d: any) => {
      const ringing = useCallStore.getState().incomingCall
      if (!ringing) return null
      const same = d.dm_id ? String(d.dm_id) === ringing.dmId : String(d.from) === ringing.fromUserId
      return same ? ringing : null
    }
    const offEnded = on('DM_CALL_ENDED', (d: any) => {
      // Modal encore affiché = l'appel a sonné ici sans être décroché → manqué
      const ringing = isRinging(d)
      if (ringing) {
        toast(tr('toast.missedCall', { name: ringing.fromUsername }), {
          duration: 8000,
          style: { cursor: 'pointer' },
          onClick: () => nav(`/dms/${ringing.dmId}`),
        } as any)
        setIncomingCall(null)
      }
      qcHook.invalidateQueries({ queryKey: ['call_history'] })
    })
    const offDeclined = on('DM_CALL_DECLINED', (d: any) => {
      if (isRinging(d)) setIncomingCall(null)
      qcHook.invalidateQueries({ queryKey: ['call_history'] })
    })
    const offCallError = on('DM_CALL_ERROR', (d: any) => {
      if (d.reason === 'offline') {
        toast(tr('toast.contactOffline'), { icon: '📵', duration: 4000 })
      } else if (d.reason === 'rate_limited') {
        toast(tr('toast.callRateLimited'), { icon: '⏳', duration: 5000 })
      }
    })
    return () => { offIncoming(); offEnded(); offDeclined(); offCallError() }
  }, [user?.id, playRing])

  // Expiration du modal d'appel entrant si l'appelant a disparu sans envoyer HANGUP
  // (crash, perte réseau) — aligné sur le timeout appelant de 45s + marge
  useEffect(() => {
    if (!incomingCall) return
    const t = setTimeout(() => setIncomingCall(null), 50_000)
    return () => clearTimeout(t)
  }, [incomingCall, setIncomingCall])

  // Notifications push pour les messages privés
  useEffect(() => {
    if (!user) return
    const getDmMuted = (dmId: string): boolean => {
      const cache = qcHook.getQueryData<any[]>(['dms'])
      return cache?.find(dm => dm.id === dmId)?.is_muted ?? false
    }
    // Aperçu d'un message chiffré : déchiffré ici, sur l'appareil.
    const preview = async (kind: 'dm' | 'group', id: string, msg: any) =>
      msg.enc ? (await openText(kind, id, msg.enc, msg.sender_id, msg.client_msg_id)) ?? tr('e2e.conv.encrypted') : msg.content
    const offDm = on('DM_MESSAGE', async (d: any) => {
      const raw = d.message
      if (!raw) return
      const msg = { ...raw, content: await preview('dm', d.dm_id, raw) }
      // Rafraîchir la liste DMs sidebar (dernier message + ordre) pour sender ET recipient
      qcHook.invalidateQueries({ queryKey: ['dms'] })
      if (msg.sender_id === user.id) return
      const currentPath = window.location.pathname
      const isActive = currentPath === `/dms/${d.dm_id}` && document.hasFocus()
      if (isActive) useUnread.getState().markReadSoon(`/dms/${d.dm_id}/read`, d.dm_id)
      if (!isActive) {
        const isMuted = getDmMuted(d.dm_id)
        incrUnread(d.dm_id)
        if (isMuted || isIgnored(msg.sender_id)) return
        if (!user.focus_mode) playMessage()
        if (document.hasFocus()) {
          // Fenêtre focusée mais sur une autre page → toast cliquable
          toast(`${msg.sender_username ?? tr('toast.privateMessage')}: ${msg.content ? msg.content.slice(0, 60) : tr('common.attachment')}`, {
            duration: 4000,
            style: { cursor: 'pointer', maxWidth: '320px' },
            onClick: () => nav(`/dms/${d.dm_id}`),
          } as any)
        } else {
          // Fenêtre non focusée → native si permission, sinon mettre en file pour afficher au focus
          const title = msg.sender_username ?? 'Message privé'
          const body = msg.content ? stripMarkdown(msg.content).slice(0, 100) : '📎 Pièce jointe'
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            sendNativeNotification(title, { body, onClick: () => nav(`/dms/${d.dm_id}`) })
          } else {
            pendingNotifs.current.push({ title, body: body.slice(0, 60), path: `/dms/${d.dm_id}` })
          }
        }
      }
    })
    const offGroupMsg = on('GROUP_DM_MESSAGE', async (d: any) => {
      const raw = d.message
      if (!raw) return
      const msg = { ...raw, content: await preview('group', d.group_id, raw) }
      qcHook.invalidateQueries({ queryKey: ['dms'] })
      if (msg.sender_id === user.id) return
      const currentPath = window.location.pathname
      const isActive = currentPath === `/dms/groups/${d.group_id}` && document.hasFocus()
      if (isActive) useUnread.getState().markReadSoon(`/dms/groups/${d.group_id}/read`, d.group_id)
      if (!isActive) {
        incrUnread(d.group_id)
        const isGroupMuted = qcHook.getQueryData<any[]>(['dms'])?.find(dm => dm.id === d.group_id)?.is_muted ?? false
        const content: string = msg.content ?? ''
        const contentClean = stripMarkdown(content)
        const escapedName = user.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const mentionedMe = !user.focus_mode && (
          new RegExp(`@${escapedName}(?:[^a-zA-Z0-9_]|$)`).test(content) ||
          content.includes('@everyone')
        )
        if (isGroupMuted || isIgnored(msg.sender_id)) return
        if (!user.focus_mode) {
          if (mentionedMe) playMention()
          else playMessage()
        }
        const goTo = () => nav(`/dms/groups/${d.group_id}`)
        const preview = content ? contentClean.slice(0, 60) : tr('common.attachment')
        if (document.hasFocus()) {
          toast(`${msg.sender_username ?? tr('dms.group')}: ${preview}`, {
            duration: mentionedMe ? 7000 : 4000,
            style: { cursor: 'pointer', maxWidth: '320px' },
            onClick: goTo,
          } as any)
        } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          sendNativeNotification(msg.sender_username ?? 'Groupe', {
            body: content ? contentClean.slice(0, 100) : '📎 Pièce jointe',
            onClick: goTo,
          })
        } else {
          pendingNotifs.current.push({
            title: msg.sender_username ?? 'Groupe',
            body: preview,
            path: `/dms/groups/${d.group_id}`,
          })
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
      const sid = d.server_id ?? d.channel?.server_id
      if (sid) qcHook.invalidateQueries({ queryKey: ['server', sid] })
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
        qcHook.invalidateQueries({ queryKey: ['my_emojis'] })
      }
    })
    const offEmojiDelete = on('EMOJI_DELETE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['emojis', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['custom_emojis', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['my_emojis'] })
      }
    })
    const offCategoryCreate = on('CATEGORY_CREATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['categories', d.server_id] })
      }
    })
    const offCategoryDelete = on('CATEGORY_DELETE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['categories', d.server_id] })
      }
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
      offEmojiCreate(); offEmojiDelete(); offCategoryCreate(); offCategoryDelete()
      offPermUpdate(); offArchive(); offMemberJoin(); offMemberLeave(); offMemberKicked(); offMemberBanned()
    }
  }, [user?.id])

  // Timeout utilisateur reçu en temps réel
  useEffect(() => {
    if (!user) return
    const offTimeout = on('USER_TIMEOUT', (d: any) => {
      toast.error(`${tr('toast.timedOut', { time: new Date(d.expires_at).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) })}${d.reason ? ` — ${d.reason}` : ''}`, { duration: 8000 })
    })
    const offLift = on('USER_TIMEOUT_LIFTED', () => {
      toast.success(tr('toast.timeoutLifted'), { duration: 4000 })
    })
    return () => { offTimeout(); offLift() }
  }, [user?.id])

  useCommunityRealtime(user?.id)

  // Rappels programmés
  useEffect(() => {
    if (!user) return
    const offReminder = on('REMINDER', (d: any) => {
      toast(d.content ?? tr('toast.reminder'), { icon: '⏰', duration: 10000 })
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
      updateUserInMessages(u.id, u.username, u.avatar ?? null, u.avatar_decoration ?? null)
      useNameStyles.getState().set(u.id, u)
      qcHook.invalidateQueries({ queryKey: ['members'] })
      qcHook.invalidateQueries({ queryKey: ['user', u.id] })
    })
    const offBoost = on('SERVER_BOOST', (d: any) => {
      toast.success(tr('toast.boosted', { name: d.username ?? tr('toast.aMember') }), { duration: 5000, icon: '🚀' })
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
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['roles', d.server_id] })
        // Réordonnancement : le classement des membres par rôle affiché change.
        if (d.reordered) qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
      }
    })
    const offMemberRoleUpdate = on('MEMBER_ROLE_UPDATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members_detailed', d.server_id] })
      }
    })
    // Le surnom se sauvegardait bien en DB (PATCH /servers/:id/nickname) mais
    // n'était diffusé nulle part -- ni l'auteur du changement ni les autres
    // membres ne le voyaient sans recharger. Même invalidation que MEMBER_ROLE_UPDATE.
    const offMemberNicknameUpdate = on('MEMBER_NICKNAME_UPDATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['server', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members_detailed', d.server_id] })
      }
    })
    // Profil par serveur (avatar, bannière, bio) : même invalidation que le surnom.
    const offMemberProfileUpdate = on('MEMBER_PROFILE_UPDATE', (d: any) => {
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['member', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members', d.server_id] })
        qcHook.invalidateQueries({ queryKey: ['members_detailed', d.server_id] })
      }
    })
    return () => {
      offUserUpdate(); offBoost(); offTagAssign(); offTagRemove()
      offMemberTimeout(); offMemberTimeoutLifted(); offRoleCreate(); offRoleDelete(); offRoleUpdate(); offMemberRoleUpdate()
      offMemberNicknameUpdate(); offMemberProfileUpdate()
      offServerTagCreate(); offServerTagDelete()
    }
  }, [user?.id])

  // Expulsion/ban → forcer le retour à l'accueil + refresh liste serveurs
  useEffect(() => {
    if (!user) return
    const offKicked = on('MEMBER_KICKED', (d: any) => {
      toast.error(tr('toast.kicked'), { duration: 6000 })
      if (d.server_id) {
        qcHook.invalidateQueries({ queryKey: ['servers'] })
        qcHook.removeQueries({ queryKey: ['server', d.server_id] })
        qcHook.removeQueries({ queryKey: ['members', d.server_id] })
      }
      nav('/')
    })
    const offBanned = on('MEMBER_BANNED', (d: any) => {
      toast.error(tr('toast.banned'), { duration: 6000 })
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

  // Raccourcis clavier globaux (personnalisables : Réglages > Raccourcis clavier)
  useGlobalShortcuts({
    togglePalette: () => setShowCommandPalette(q => !q),
    toggleQuickSwitcher: () => setShowQuickSwitcher(q => !q),
    toggleHelp: () => setShowKeyboardShortcuts(q => !q),
    closeAll: () => { setShowQuickSwitcher(false); setShowCommandPalette(false); setShowKeyboardShortcuts(false) },
  })
  useEffect(() => {
    // Ouverture du QuickSwitcher depuis le bouton loupe du rail (mobile sans Ctrl+K)
    const openQs = () => setShowQuickSwitcher(true)
    // Modale des raccourcis depuis la palette de commandes
    const openShortcuts = () => setShowKeyboardShortcuts(true)
    window.addEventListener('forgechat:open-quick-switcher', openQs)
    window.addEventListener('forgechat:open-shortcuts', openShortcuts)
    return () => {
      window.removeEventListener('forgechat:open-quick-switcher', openQs)
      window.removeEventListener('forgechat:open-shortcuts', openShortcuts)
    }
  }, [])

  return (
    <>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/fonctionnalites" element={<FonctionnalitesPage />} />
          <Route path="/telecharger" element={<TelechargerPage />} />
          <Route path="/telecharger/:plateforme" element={<TelechargerPlateformePage />} />
          <Route path="/nouveautes" element={<NouveautesPage />} />
          <Route path="/aide" element={<AidePage />} />
          <Route path="/a-propos" element={<AProposPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/mentions-legales" element={<MentionsLegalesPage />} />
          <Route path="/confidentialite" element={<ConfidentialitePage />} />
          <Route path="/cgu" element={<CguPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<PasswordResetPage />} />
          <Route path="/reset-password" element={<PasswordResetPage />} />
          <Route path="/verrouiller" element={<LockAccountPage />} />
          <Route path="/statut" element={<StatusPage />} />
          <Route path="/sauvegarde" element={<BackupViewerPage />} />
          <Route path="/invite/:code" element={<InvitePage />} />
          <Route path="/friend-invite/:code" element={<FriendInvitePage />} />
          <Route path="/settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
          <Route path="/" element={<HomeRoute />} />
          <Route element={<AuthGuard><MainLayout /></AuthGuard>}>
            <Route path="friends" element={<FriendsPage />} />
            <Route path="users/:userId" element={<UserProfilePage />} />
            <Route path="saved" element={<SavedPage />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="scheduled" element={<ScheduledPage />} />
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
            <Route path="admin/diagnostics" element={<DiagnosticsAdminPage />} />
            <Route path="admin/signalements" element={<DmReportsAdminPage />} />
            <Route path="admin/site" element={<SiteAdminPage />} />
            <Route path="import-discord" element={<ImportDiscordPage />} />
          </Route>
          {/* Adresse inconnue : accueil plutôt qu'un écran noir. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {/* Montés ici (racine, hors de <Routes>) et non dans MainLayout : /settings est une
            route de premier niveau, structurellement HORS de MainLayout (plein écran sans
            sidebars, voulu) — un appel en cours doit rester audible/visible même là, pas
            seulement sur les routes wrappées par MainLayout. */}
        {user && <PersistentVoiceAudio />}
        {user && <PersistentDmCallAudio />}
        {user && <UserVolumePopover />}
        {user && <UserMenuHost />}
        {user && <GroupCallRinger />}
        {user && <FloatingCallPiP />}
        {user && <VoiceHotkeys />}
        {user && <E2EGate />}
        {user && <KeyChangeDialog />}
        {user && <KeyTransparencyMonitor />}
        {showQuickSwitcher && <QuickSwitcher onClose={() => setShowQuickSwitcher(false)} />}
        <CommandPalette isOpen={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
        {showKeyboardShortcuts && <KeyboardShortcutsModal onClose={() => setShowKeyboardShortcuts(false)} />}
        {showOnboarding && user && <Onboarding onDone={() => setShowOnboarding(false)} />}
      </Suspense>
      <ConfirmModal />
      {user && <AppLockOverlay userId={user.id} />}
      {/* Bannière de reconnexion WS */}
      {showDisconnectBanner && (
        <div className="fixed top-0 inset-x-0 z-[9998] flex items-center justify-center gap-2 bg-yellow-600/95 text-white text-xs font-medium py-1.5 px-4">
          <span className="inline-block w-2 h-2 rounded-full bg-white/70 animate-pulse flex-shrink-0" />
          Connexion perdue — reconnexion en cours…
        </div>
      )}

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
import { ConfirmModal } from './components/ui/ConfirmModal'
import { t as tr, useLang, intlLocale } from './i18n'
import { useNameStyles } from './store/nameStyles'
import { useStreamerAuto } from './lib/streamerMode'

function IncomingCallModal({ call, onAccept, onDecline }: {
  call: IncomingCallInfo
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <div className="fixed bottom-6 right-6 z-[9999] bg-fc-channel border border-fc-hover rounded-2xl shadow-2xl p-5 w-80 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-fc-accent flex items-center justify-center text-lg font-bold text-white flex-shrink-0 streamer-blur">
          {call.fromUsername.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-white font-semibold text-sm streamer-blur">{call.fromUsername}</p>
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
  if (!isTauri) return <AccueilPage />
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-fc-bg">
      <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  return <Navigate to={user ? '/friends' : '/login'} replace />
}

function LocationBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  // Serveur affiché : son apparence (thème, catégories) remplace celle de ForgeChat s'il en a une.
  const serverId = /^\/servers\/([0-9a-f-]{36})/i.exec(location.pathname)?.[1] ?? null
  useEffect(() => { useThemeStore.getState().setServerId(serverId) }, [serverId])
  return <ErrorBoundary resetKey={location.key}>{children}</ErrorBoundary>
}

export default function App() {
  return (
    <BrowserRouter>
      <LocationBoundary>
        <AppInner />
      </LocationBoundary>
    </BrowserRouter>
  )
}
