import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './store/auth'
import { useWs } from './store/ws'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import InvitePage from './pages/InvitePage'
import MainLayout from './components/layout/MainLayout'
import ChannelPage from './pages/ChannelPage'
import DMPage from './pages/DMPage'
import FriendsPage from './pages/FriendsPage'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-fc-bg">
      <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  const { fetchMe, user } = useAuth()
  const { connect, disconnect } = useWs()

  useEffect(() => { fetchMe() }, [])

  useEffect(() => {
    if (!user) return
    const token = localStorage.getItem('access_token')
    if (token) connect(token)
    return () => disconnect()
  }, [user?.id])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="/" element={<AuthGuard><MainLayout /></AuthGuard>}>
          <Route index element={<FriendsPage />} />
          <Route path="friends" element={<FriendsPage />} />
          <Route path="dms/:dmId" element={<DMPage />} />
          <Route path="servers/:serverId" element={<ChannelPage />} />
          <Route path="servers/:serverId/channels/:channelId" element={<ChannelPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
