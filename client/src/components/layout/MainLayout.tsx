import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import ServerSidebar from './ServerSidebar'
import ChannelSidebar from './ChannelSidebar'
import UserPanel from './UserPanel'
import VoiceBar from '../voice/VoiceBar'
import RightSidebar, { useRightSidebar } from './RightSidebar'
import ChannelPage from '../../pages/ChannelPage'
import { SplitContext } from '../../contexts/SplitContext'
import { MobileContext } from '../../contexts/MobileContext'

export default function MainLayout() {
  const { open: activityOpen, toggle: toggleActivity, close: closeActivity } = useRightSidebar()
  const [splitChannelId, setSplitChannelId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  // Auto-close mobile drawer on navigation
  useEffect(() => {
    setSidebarOpen(false)
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

          {/* Sidebars — drawer fixe sur mobile, inline sur desktop */}
          <div className={[
            'flex h-full flex-shrink-0',
            'fixed inset-y-0 left-0 z-50',
            'md:static md:inset-auto md:z-auto',
            'transition-transform duration-300 ease-in-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          ].join(' ')}>
            <ServerSidebar />
            <div className="flex flex-col w-60 bg-fc-channel flex-shrink-0 h-full">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                <ChannelSidebar />
              </div>
              <VoiceBar />
              <UserPanel onToggleActivity={toggleActivity} activityOpen={activityOpen} />
            </div>
          </div>

          {/* Zone principale */}
          <div className="flex flex-1 overflow-hidden min-w-0">
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">
              <Outlet />
            </div>

            {/* Panneau split — second canal (desktop uniquement) */}
            {splitChannelId && (
              <div className="hidden md:flex flex-1 border-l border-fc-hover overflow-hidden min-w-0">
                <ChannelPage
                  forcedChannelId={splitChannelId}
                  isSplit
                  onClose={() => setSplitChannelId(null)}
                />
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
