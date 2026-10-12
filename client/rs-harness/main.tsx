// Banc LOCAL du support à distance (piloté par scripts/remoteSupport.playwright.mjs) : les vraies
// cartes RemoteSupportCard, sans serveur. Les envois chiffrés sont remplacés par `window.sent`.
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { RemoteSupportCard, useSupportSender } from '../src/components/chat/RemoteSupport'
import { ConfirmModal } from '../src/components/ui/ConfirmModal'
import type { SupportPayload } from '../src/lib/remoteSupport'

const DM = 'dm-banc'
const w = window as unknown as { sent: SupportPayload[] }
w.sent = []
const send = async (rs: SupportPayload) => { w.sent.push(rs) }
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const msg = (cmid: string, rs: SupportPayload) => ({
  id: cmid, channel_id: DM, client_msg_id: cmid, author_id: ALICE, author_username: 'alice', e2e_body: { t: '', rs },
})
// Support à distance réservé aux amis : alice en est une (pas de serveur dans le banc).
const qc = new QueryClient()
qc.setQueryData(['profile', ALICE], { relationship: 'friend' })

function Banc() {
  useSupportSender(DM, send)
  return (
    <>
      <section data-testid="offer"><RemoteSupportCard isOwn={false} msg={msg('11111111-1111-4111-8111-111111111111', { v: 1, k: 'offer' })} /></section>
      <section data-testid="invite"><RemoteSupportCard isOwn={false} msg={msg('22222222-2222-4222-8222-222222222222', {
        v: 1, k: 'invite', id: '482915036', code: '7K2MQ9XR4TVB', exp: Date.now() + 600_000,
      })} /></section>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}>
    <MemoryRouter><Banc /><ConfirmModal /><Toaster /></MemoryRouter>
  </QueryClientProvider>,
)
