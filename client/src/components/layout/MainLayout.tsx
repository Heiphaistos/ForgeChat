import { Outlet } from 'react-router-dom'
import ServerSidebar from './ServerSidebar'
import ChannelSidebar from './ChannelSidebar'
import UserPanel from './UserPanel'

export default function MainLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-fc-bg">
      {/* Barre des serveurs (gauche, étroite) */}
      <ServerSidebar />

      {/* Sidebar canaux */}
      <div className="flex flex-col w-60 bg-fc-channel flex-shrink-0">
        <ChannelSidebar />
        <UserPanel />
      </div>

      {/* Zone principale */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
