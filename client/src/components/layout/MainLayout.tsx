import { Outlet } from 'react-router-dom'
import ServerSidebar from './ServerSidebar'
import ChannelSidebar from './ChannelSidebar'
import UserPanel from './UserPanel'
import VoiceBar from '../voice/VoiceBar'
import RightSidebar, { useRightSidebar } from './RightSidebar'

export default function MainLayout() {
  const { open: activityOpen, toggle: toggleActivity, close: closeActivity } = useRightSidebar()

  return (
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
      <div className="flex flex-col flex-1 overflow-hidden">
        <Outlet />
      </div>

      {/* Sidebar droite — Activité récente */}
      <RightSidebar visible={activityOpen} onClose={closeActivity} />
    </div>
  )
}
