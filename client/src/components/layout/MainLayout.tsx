import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import ServerSidebar from './ServerSidebar'
import ChannelSidebar from './ChannelSidebar'
import UserPanel from './UserPanel'
import VoiceBar from '../voice/VoiceBar'
import RightSidebar, { useRightSidebar } from './RightSidebar'
import { SplitContext } from '../../contexts/SplitContext'
import { MobileContext } from '../../contexts/MobileContext'

const ChannelPage = lazy(() => import('../../pages/ChannelPage'))

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 360
const SIDEBAR_DEFAULT = 240

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export default function MainLayout() {
  const { open: activityOpen, toggle: toggleActivity, close: closeActivity } = useRightSidebar()
  const [splitChannelId, setSplitChannelId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('fc_sidebar_width')
    return saved ? clamp(parseInt(saved, 10), SIDEBAR_MIN, SIDEBAR_MAX) : SIDEBAR_DEFAULT
  })
  const resizing = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

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
    const onUp = () => {
      if (!resizing.current) return
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSidebarWidth(w => {
        localStorage.setItem('fc_sidebar_width', String(w))
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Auto-close mobile drawer on navigation — sauf quand on navigue vers la racine
  // d'un serveur (ex: /servers/X), car ChannelPage va auto-naviguer vers le premier
  // canal : on reste ouvert pour que l'utilisateur puisse choisir son canal.
  useEffect(() => {
    const isServerRoot = /^\/servers\/[^/]+$/.test(location.pathname)
    if (!isServerRoot) {
      setSidebarOpen(false)
    }
  }, [location.pathname])

  // Ctrl+Shift+S — fermer le split
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 's') {
        e.preventDefault()
        setSplitChannelId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <MobileContext.Provider value={{
      sidebarOpen,
      openSidebar: () => setSidebarOpen(true),
      closeSidebar: () => setSidebarOpen(false),
    }}>
      <SplitContext.Provider value={{ splitChannelId, setSplitChannelId }}>
        <div className="flex h-screen overflow-hidden bg-fc-bg">

          {/* Mobile backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/60 z-40 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Bouton hamburger global mobile — fallback pour les pages sans bouton dédié */}
          {!sidebarOpen && (
            <button
              className="fixed top-2.5 left-2.5 z-30 md:hidden p-2 rounded-xl bg-fc-channel/95 text-white shadow-xl backdrop-blur-sm border border-fc-hover/40"
              onClick={() => setSidebarOpen(true)}
              title="Menu"
              aria-label="Ouvrir le menu"
            >
              <Menu size={20} />
            </button>
          )}

          {/* Sidebars — drawer fixe sur mobile, inline sur desktop */}
          <div className={[
            'flex h-full flex-shrink-0',
            'fixed inset-y-0 left-0 z-50',
            'md:static md:inset-auto md:z-auto',
            'transition-transform duration-300 ease-in-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          ].join(' ')}>
            <ServerSidebar />
            <div
              className="flex flex-col bg-fc-channel flex-shrink-0 h-full"
              style={{ width: `${sidebarWidth}px` }}
            >
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                <ChannelSidebar />
              </div>
              <VoiceBar />
              <UserPanel onToggleActivity={toggleActivity} activityOpen={activityOpen} />
            </div>
          </div>

          {/* Handle de redimensionnement sidebar — desktop uniquement */}
          <div
            className="hidden md:flex w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-fc-accent/40 transition-colors group z-10"
            onMouseDown={onResizeStart}
            title="Redimensionner la barre latérale"
          >
            <div className="w-px h-full bg-fc-hover group-hover:bg-fc-accent/60 transition-colors" />
          </div>

          {/* Zone principale */}
          <div className="flex flex-1 overflow-hidden min-w-0">
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">
              <Outlet />
            </div>

            {/* Panneau split — second canal (desktop uniquement) */}
            {splitChannelId && (
              <div className="hidden md:flex flex-1 border-l border-fc-hover overflow-hidden min-w-0">
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" /></div>}>
                  <ChannelPage
                    forcedChannelId={splitChannelId}
                    isSplit
                    onClose={() => setSplitChannelId(null)}
                  />
                </Suspense>
              </div>
            )}
          </div>

          {/* Sidebar droite — Activité récente */}
          <RightSidebar visible={activityOpen} onClose={closeActivity} />
        </div>
      </SplitContext.Provider>
    </MobileContext.Provider>
  )
}
