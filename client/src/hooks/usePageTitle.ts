import { useEffect } from 'react'

// Titre d'onglet « X | ForgeChat » en préservant le badge (n) de non-lus,
// même convention que ChannelPage/DMPage/GroupDMPage
export function usePageTitle(title: string) {
  useEffect(() => {
    const prefix = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
    document.title = `${prefix}${title} | ForgeChat`
    return () => {
      const p = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
      document.title = `${p}ForgeChat`
    }
  }, [title])
}
