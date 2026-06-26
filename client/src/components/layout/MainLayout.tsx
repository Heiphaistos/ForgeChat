import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import ServerSidebar from './ServerSidebar'
import ChannelSidebar from './ChannelSidebar'
import UserPanel from './UserPanel'
import VoiceBar from '../voice/VoiceBar'
import RightSidebar, { useRightSidebar } from './RightSidebar'
import ChannelPage from '../../pages/ChannelPage'
import { SplitContext } from '../../contexts/SplitContext'

export default function MainLayout() {
  const { open: activityOpen, toggle: toggleActivity, close: closeActivity } = useRightSidebar()
  const [splitChannelId, setSplitChannelId] = useState<string | null>(null)

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
    <SplitContext.Provider value={{ splitChannelId, setSplitChannelId }}>
      <div className="flex h-screen overflow-hidden bg-fc-bg">
        {/* Barre des serveurs (gauche, étroite) */}
        <ServerSidebar />

        {/* Sidebar canaux + panel utilisateur */}
        <div className="flex flex-col w-60 bg-fc-channel flex-shrink-0">
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <ChannelSidebar />
          </div>
          {/* VoiceBar s'affiche seulement si connecté à un canal vocal */}
          <VoiceBar />
          <UserPanel onToggleActivity={toggleActivity} activityOpen={activityOpen} />
        </div>

        {/* Zone principale */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <Outlet />
          </div>

          {/* Panneau split — second canal */}
          {splitChannelId && (
            <div className="flex-1 border-l border-fc-hover overflow-hidden min-w-0">
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
  )
}
