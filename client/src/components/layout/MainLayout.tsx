import { useState, useEffect, useRef, useCallback, lazy, Suspense, useSyncExternalStore } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import ServerSidebar from './ServerSidebar'
import ChannelSidebar from './ChannelSidebar'
import UserPanel from './UserPanel'
import VoiceBar from '../voice/VoiceBar'
import RightSidebar, { useRightSidebar } from './RightSidebar'
import ConnectionBanner from './ConnectionBanner'
import { SplitContext } from '../../contexts/SplitContext'
import { MobileContext } from '../../contexts/MobileContext'

const ChannelPage = lazy(() => import('../../pages/ChannelPage'))

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 360
const SIDEBAR_DEFAULT = 240

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

// Detect desktop vs mobile, reactive to resize
function useIsMobile() {
  return !useSyncExternalStore(
    cb => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb) },
    () => window.innerWidth >= 768,
    () => true,
  )
}

export default function MainLayout() {
  const { open: activityOpen, toggle: toggleActivity, close: closeActivity } = useRightSidebar()
  // Split view restauré après refresh (sessionStorage — durée de vie de l'onglet)
  const [splitChannelId, setSplitChannelId] = useState<string | null>(
    () => sessionStorage.getItem('fc_split_channel')
  )
  useEffect(() => {
    if (splitChannelId) sessionStorage.setItem('fc_split_channel', splitChannelId)
    else sessionStorage.removeItem('fc_split_channel')
  }, [splitChannelId])

  // Largeur du panneau split (ratio 0.25–0.75, persisté)
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('fc_split_ratio') ?? '')
    return Number.isFinite(saved) ? clamp(saved, 0.25, 0.75) : 0.5
  })
  const splitResizing = useRef(false)
  const onSplitResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    splitResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!splitResizing.current) return
      const main = document.getElementById('fc-main')
      if (!main) return
      const rect = main.getBoundingClientRect()
      setSplitRatio(clamp((rect.right - e.clientX) / rect.width, 0.25, 0.75))
    }
    const onUp = () => {
      if (!splitResizing.current) return
      splitResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSplitRatio(r => { localStorage.setItem('fc_split_ratio', String(r)); return r })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isMobile = useIsMobile()
  const location = useLocation()

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('fc_sidebar_width')
    return saved ? clamp(parseInt(saved, 10), SIDEBAR_MIN, SIDEBAR_MAX) : SIDEBAR_DEFAULT
  })
  const resizing = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)
  const navSwipeX = useRef<number | null>(null)
  const edgeSwipe = useRef<{ x: number; y: number } | null>(null)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    resizing.current = true
    startX.current = e.clientX
    startW.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const delta = e.clientX - startX.current
      const next = clamp(startW.current + delta, SIDEBAR_MIN, SIDEBAR_MAX)
      setSidebarWidth(next)
    }
    const SNAP_SIZES = [180, 220, 240, 280, 320]
    const SNAP_THRESHOLD = 15
    const onUp = () => {
      if (!resizing.current) return
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSidebarWidth(w => {
        const snapped = SNAP_SIZES.find(s => Math.abs(w - s) <= SNAP_THRESHOLD) ?? w
        localStorage.setItem('fc_sidebar_width', String(snapped))
        return snapped
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Auto-close mobile drawer on navigation.
  // Exception : auto-navigation ChannelPage (state.autoNav=true) → garder la sidebar
  // ouverte pour permettre à l'utilisateur de choisir un canal différent sur mobile.
  useEffect(() => {
    const isAutoNav = (location.state as any)?.autoNav === true
    const isServerRoot = /^\/servers\/[^/]+$/.test(location.pathname)
    if (!isAutoNav && !isServerRoot) {
      setSidebarOpen(false)
    }
  }, [location.pathname, location.state])

  // Ctrl+Shift+S — toggle split (ouvre le canal courant ou ferme)
  // Escape — ferme le split si aucune modale ouverte et focus hors input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 's') {
        e.preventDefault()
        if (splitChannelId) {
          setSplitChannelId(null)
        } else {
          const m = window.location.pathname.match(/\/servers\/[^/]+\/channels\/([^/]+)/)
          if (m) setSplitChannelId(m[1])
        }
      }
      if (e.key === 'Escape' && splitChannelId) {
        const el = document.activeElement as HTMLElement | null
        const inInput = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        const modalOpen = !!document.querySelector('[role="dialog"], [role="alertdialog"]')
        if (!inInput && !modalOpen) setSplitChannelId(null)
      }
    }
    // Toggle du split depuis la palette de commandes
    const toggleSplit = () => {
      if (splitChannelId) {
        setSplitChannelId(null)
      } else {
        const m = window.location.pathname.match(/\/servers\/[^/]+\/channels\/([^/]+)/)
        if (m) setSplitChannelId(m[1])
      }
    }
    window.addEventListener('forgechat:toggle-split', toggleSplit)
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('forgechat:toggle-split', toggleSplit)
      window.removeEventListener('keydown', handler)
    }
  }, [splitChannelId])

  return (
    <MobileContext.Provider value={{
      sidebarOpen,
      openSidebar: () => setSidebarOpen(true),
      closeSidebar: () => setSidebarOpen(false),
    }}>
      <SplitContext.Provider value={{ splitChannelId, setSplitChannelId }}>
        <div className="flex h-dvh overflow-hidden bg-fc-bg">

          {/* Skip navigation — a11y clavier */}
          <a
            href="#fc-main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:bg-white focus:text-black focus:text-sm focus:font-semibold focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg"
          >
            Passer au contenu principal
          </a>

          {/* Bannière d'état de connexion (WS + réseau navigateur) */}
          <ConnectionBanner />

          {/* Mobile backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/60 z-40 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebars — drawer fixe sur mobile, inline sur desktop */}
          <nav
            aria-label="Navigation"
            className={[
              'flex h-full flex-shrink-0',
              'fixed inset-y-0 left-0 z-50',
              'md:static md:inset-auto md:z-auto',
              'transition-transform duration-300 ease-in-out will-change-transform',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
            ].join(' ')}
            onTouchStart={e => { if (sidebarOpen) navSwipeX.current = e.touches[0].clientX }}
            onTouchEnd={e => {
              if (!sidebarOpen || navSwipeX.current === null) return
              if (e.changedTouches[0].clientX - navSwipeX.current < -60) setSidebarOpen(false)
              navSwipeX.current = null
            }}
          >
            <ServerSidebar />
            <div
              className="flex flex-col bg-fc-channel flex-shrink-0 h-full"
              style={{ width: isMobile ? 'calc(100vw - 72px)' : `${sidebarWidth}px` }}
            >
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                <ChannelSidebar />
              </div>
              <VoiceBar />
              <UserPanel onToggleActivity={toggleActivity} activityOpen={activityOpen} />
            </div>
          </nav>

          {/* Handle de redimensionnement sidebar — desktop uniquement */}
          <div
            className="hidden md:flex w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-fc-accent/40 transition-colors group z-10"
            onMouseDown={onResizeStart}
            onDoubleClick={() => { setSidebarWidth(SIDEBAR_DEFAULT); localStorage.setItem('fc_sidebar_width', String(SIDEBAR_DEFAULT)) }}
            title="Redimensionner la barre latérale (double-clic : largeur par défaut)"
          >
            <div className="w-px h-full bg-fc-hover group-hover:bg-fc-accent/60 transition-colors" />
          </div>

          {/* Zone principale — edge-swipe depuis le bord gauche pour ouvrir la sidebar (mobile) */}
          <main
            id="fc-main"
            className="relative flex flex-1 overflow-hidden min-w-0"
            onTouchStart={e => {
              const t = e.touches[0]
              edgeSwipe.current = isMobile && !sidebarOpen && t.clientX <= 20
                ? { x: t.clientX, y: t.clientY }
                : null
            }}
            onTouchEnd={e => {
              if (!edgeSwipe.current) return
              const dx = e.changedTouches[0].clientX - edgeSwipe.current.x
              const dy = Math.abs(e.changedTouches[0].clientY - edgeSwipe.current.y)
              edgeSwipe.current = null
              if (dx > 60 && dy < 80) setSidebarOpen(true)
            }}
          >
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">
              <Outlet />
            </div>

            {/* Handle de redimensionnement du split — desktop uniquement */}
            {splitChannelId && (
              <div
                className="hidden md:flex w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-fc-accent/40 transition-colors group/split z-10"
                onMouseDown={onSplitResizeStart}
                onDoubleClick={() => { setSplitRatio(0.5); localStorage.setItem('fc_split_ratio', '0.5') }}
                title="Redimensionner le panneau split (double-clic : 50/50)"
              >
                <div className="w-px h-full bg-fc-hover group-hover/split:bg-fc-accent/60 transition-colors" />
              </div>
            )}

            {/* Panneau split — second canal (desktop uniquement) */}
            {splitChannelId && (
              <div
                className="hidden md:flex overflow-hidden min-w-0"
                style={{ flex: `0 0 ${splitRatio * 100}%` }}
              >
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" /></div>}>
                  <ChannelPage
                    forcedChannelId={splitChannelId}
                    isSplit
                    onClose={() => setSplitChannelId(null)}
                  />
                </Suspense>
              </div>
            )}

            {/* Sidebar droite — Activité récente (overlay absolu sur mobile, colonne sur desktop) */}
            <RightSidebar visible={activityOpen} onClose={closeActivity} />
          </main>
        </div>
      </SplitContext.Provider>
    </MobileContext.Provider>
  )
}
