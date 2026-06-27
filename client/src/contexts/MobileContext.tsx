import { createContext, useContext } from 'react'

interface MobileContextType {
  sidebarOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
}

export const MobileContext = createContext<MobileContextType>({
  sidebarOpen: false,
  openSidebar: () => {},
  closeSidebar: () => {},
})

export const useMobile = () => useContext(MobileContext)
