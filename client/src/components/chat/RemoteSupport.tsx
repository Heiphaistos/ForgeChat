// Support à distance natif (GhostHandDesk) dans un MP : bouton d'en-tête et carte de message.
// L'identifiant et le code partent dans le contenu chiffré de bout en bout (`rs`), jamais en clair.
import { useEffect, useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useChat } from '../../store/chat'
import { useAuth } from '../../store/auth'
import { useT, t as tr } from '../../i18n'
import type { ContextMenuItem } from '../ui/ContextMenu'
import {
  GHD_SITE, connectLink, expired, formatCode, formatId, invite, isDeviceId, newCode, parseSupport, shareLink, webViewerLink,
  type SupportPayload,
} from '../../lib/remoteSupport'

type Sender = (rs: SupportPayload) => Promise<void>
const senders = new Map<string, Sender>()

/** DMPage branche ici son envoi chiffré (même chemin que les messages : withSeal + `extra`). */
export function useSupportSender(dmId: string | undefined, send: Sender) {
  useEffect(() => {
    if (!dmId) return
    senders.set(dmId, send)
    return () => { if (senders.get(dmId) === send) senders.delete(dmId) }
  }, [dmId, send])
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const ID_KEY = 'fc_ghd_id'
const savedId = () => { try { return localStorage.getItem(ID_KEY) ?? '' } catch { return '' } }

/** Ouvre un lien ghosthanddesk:// (appli) ou https (navigateur), y compris depuis l'appli de bureau. */
async function openExternal(url: string) {
  // Lien d'application : confirmation explicite avant de lancer un programme local.
  if (url.startsWith('ghosthanddesk:') && !window.confirm(tr('rs.confirmOpen'))) return
  if (!/^(https:|ghosthanddesk:)/.test(url)) return
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('plugin:shell|open', { path: url })
  } else if (url.startsWith('ghosthanddesk:')) {
    window.location.href = url
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

async function send(dmId: string, rs: SupportPayload) {
  const s = senders.get(dmId)
  if (!s) return
  // L'échec de l'envoi lui-même est signalé par la mutation d'envoi du MP.
  try { await s(rs) } catch { /* déjà signalé */ }
}

/** Hôte : arme le code dans GhostHandDesk puis envoie l'invitation (identifiant + code) chiffrée. */
async function startHosting(dmId: string, id: string, ref?: string) {
  try { localStorage.setItem(ID_KEY, id) } catch { /* préférence non mémorisée */ }
  const code = newCode()
  openExternal(shareLink(code)).catch(() => {})
  await send(dmId, invite(id, code, Date.now(), ref))
}

function IdForm({ onSubmit, onCancel }: { onSubmit: (id: string) => void; onCancel: () => void }) {
  const t = useT()
  const [id, setId] = useState(savedId)
  const ok = isDeviceId(id)
  return (
    <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (ok) onSubmit(id.replace(/\D/g, '')) }}>
      <label className="block text-xs text-fc-muted">
        {t('rs.myId')}
        <input value={id} onChange={e => setId(e.target.value)} inputMode="numeric" maxLength={11} placeholder="123 456 789" autoFocus
          className="mt-1 w-full rounded bg-fc-bg px-2 py-1.5 font-mono text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent" />
      </label>
      <p className="text-[11px] text-fc-muted">{id && !ok ? t('rs.badId') : t('rs.myIdHint')}</p>
      <div className="flex gap-2">
        <button type="submit" disabled={!ok} className="rounded bg-fc-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">{t('rs.send')}</button>
        <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-xs text-fc-muted hover:text-white">{t('rs.cancel')}</button>
      </div>
    </form>
  )
}

/**
 * « Support à distance » avec quelqu'un depuis n'importe où (menus d'un membre, appel,
 * barre vocale) : ouvre (ou crée) le MP et y déplie le menu ci-dessous (`?support=1`).
 * `null` pour soi-même.
 */
export function useRemoteSupportItem() {
  const nav = useNavigate()
  const me = useAuth(s => s.user?.id)
  return (userId: string, label = tr('rs.button')): ContextMenuItem | null => userId === me ? null : {
    label, icon: <LifeBuoy size={14} />,
    onClick: () => {
      api.post(`/dms/${userId}`)
        .then(r => nav(`/dms/${r.data.dm_id}?support=1`))
        .catch(() => toast.error(tr('msg.openDmFailed')))
    },
  }
}

/** Bouton du MP (en-tête, ou barre d'appel avec `round`) : « Aider » ou « Demander de l'aide ». */
export function RemoteSupportButton({ dmId, autoOpen = false, round = false }: { dmId: string; autoOpen?: boolean; round?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState<null | 'menu' | 'id'>(null)
  // Ouvert d'office quand on arrive par « Support à distance » (menu d'un membre, d'un ami…) ;
  // le paramètre est consommé pour qu'une nouvelle demande vers ce même MP le rouvre.
  const [params, setParams] = useSearchParams()
  const asked = autoOpen && params.get('support') === '1'
  useEffect(() => {
    if (!asked) return
    setOpen('menu')
    setParams(p => { p.delete('support'); return p }, { replace: true })
  }, [asked, setParams])
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => (o ? null : 'menu'))} title={t('rs.button')} aria-label={t('rs.button')} aria-expanded={!!open}
        className={round
          ? `p-3 rounded-full transition ${open ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`
          : `min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 rounded transition ${open ? 'text-white bg-fc-hover' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}>
        <LifeBuoy size={round ? 20 : 18} />
      </button>
      {open && (
        <div className={`absolute z-50 w-72 max-w-[calc(100vw-24px)] rounded-lg border border-fc-hover bg-fc-sidebar p-2 shadow-xl ${round ? 'bottom-full left-1/2 -translate-x-1/2 mb-2' : 'right-0 top-full mt-1'}`}>
          {open === 'menu' ? (
            <div className="flex flex-col">
              <button className="rounded px-2 py-2 text-left text-sm text-fc-text hover:bg-fc-hover"
                onClick={() => { setOpen(null); send(dmId, { v: 1, k: 'offer' }) }}>{t('rs.help')}</button>
              <button className="rounded px-2 py-2 text-left text-sm text-fc-text hover:bg-fc-hover" onClick={() => setOpen('id')}>{t('rs.ask')}</button>
            </div>
          ) : (
            <IdForm onCancel={() => setOpen(null)} onSubmit={id => { setOpen(null); startHosting(dmId, id) }} />
          )}
        </div>
      )}
    </div>
  )
}

const usedKey = (cmid: string) => `fc_rs_used:${cmid}`
const wasUsed = (cmid: string) => { try { return !!localStorage.getItem(usedKey(cmid)) } catch { return false } }

/** Carte d'un message de support (contenu `rs` déchiffré). */
export function RemoteSupportCard({ msg, isOwn }: { msg: any; isOwn: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const rs = parseSupport(msg.e2e_body?.rs)
  const dmId: string = msg.channel_id
  const cmid: string = msg.client_msg_id ?? ''
  // Réponses déjà échangées (accept / decline / invite en retour d'une offre).
  const replyKind = useChat(s => (s.messagesByChannel[dmId] ?? []).map(m => parseSupport(m.e2e_body?.rs)).find(r => r?.ref === cmid && r.k !== 'offer')?.k ?? null)
  const reply = replyKind ? { k: replyKind } : null
  const [askId, setAskId] = useState(false)
  const [used, setUsed] = useState(() => wasUsed(cmid))
  const [, tick] = useState(0)
  useEffect(() => {
    if (rs?.k !== 'invite' || expired(rs)) return
    const id = setTimeout(() => tick(n => n + 1), Math.min(2 ** 31 - 1, (rs.exp ?? 0) - Date.now() + 50))
    return () => clearTimeout(id)
  }, [rs?.k, rs?.exp])
  if (!rs || !cmid) return null
  // Mon message : le nom du correspondant (infos du MP déjà chargées par DMPage).
  const name = isOwn ? (qc.getQueryData<{ username?: string } | null>(['dm_info', dmId])?.username ?? '') : msg.author_username
  const btn = 'rounded px-3 py-1.5 text-xs font-medium transition disabled:opacity-40'
  const state = reply?.k === 'decline' ? t('rs.state.declined') : reply ? t('rs.state.accepted') : null

  if (rs.k === 'accept' || rs.k === 'decline') return null
  const time = rs.exp ? new Date(rs.exp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const isExpired = expired(rs)

  const join = (how: 'app' | 'web') => {
    if (!rs.id || !rs.code) return
    try { localStorage.setItem(usedKey(cmid), '1') } catch { /* usage unique garanti par GhostHandDesk */ }
    setUsed(true)
    openExternal(how === 'app' ? connectLink(rs.id, rs.code) : webViewerLink(rs.id, rs.code)).catch(() => {})
    if (!reply) send(dmId, { v: 1, k: 'accept', ref: cmid })
  }

  return (
    <div className="mt-1.5 max-w-md rounded-lg border border-fc-accent/40 bg-fc-accent/5 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold text-white"><LifeBuoy size={16} className="text-fc-accent" aria-hidden />{t('rs.card.title')}</div>
      {rs.k === 'offer' && (
        <>
          <p className="text-fc-text">{t(isOwn ? 'rs.card.offerOut' : 'rs.card.offerIn', { name })}</p>
          {!isOwn && !reply && !askId && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={`${btn} bg-fc-accent text-white`} onClick={() => setAskId(true)}>{t('rs.accept')}</button>
              <button className={`${btn} text-fc-muted hover:text-white`} onClick={() => send(dmId, { v: 1, k: 'decline', ref: cmid })}>{t('rs.decline')}</button>
            </div>
          )}
          {askId && !reply && <div className="mt-2"><IdForm onCancel={() => setAskId(false)} onSubmit={id => { setAskId(false); startHosting(dmId, id, cmid) }} /></div>}
        </>
      )}
      {rs.k === 'invite' && rs.id && rs.code && (
        <>
          <p className="text-fc-text">{t(isOwn ? 'rs.card.inviteOut' : 'rs.card.inviteIn', { name, id: formatId(rs.id), time })}</p>
          {isOwn ? (
            !isExpired && reply?.k !== 'decline' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button className={`${btn} bg-fc-hover text-white`} onClick={() => openExternal(shareLink(rs.code!, Math.max(60, Math.round(((rs.exp ?? 0) - Date.now()) / 1000)))).catch(() => {})}>{t('rs.rearm')}</button>
                <button className={`${btn} text-fc-accent hover:underline`} onClick={() => openExternal(GHD_SITE).catch(() => {})}>{t('rs.download')}</button>
                <span className="w-full text-[11px] text-fc-muted">{t('rs.portable')}</span>
              </div>
            )
          ) : !isExpired && !used && reply?.k !== 'decline' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={`${btn} bg-fc-accent text-white`} onClick={() => join('app')}>{t('rs.openApp')}</button>
              <button className={`${btn} bg-fc-hover text-white`} onClick={() => join('web')}>{t('rs.openWeb')}</button>
              {!reply && <button className={`${btn} text-fc-muted hover:text-white`} onClick={() => send(dmId, { v: 1, k: 'decline', ref: cmid })}>{t('rs.decline')}</button>}
            </div>
          )}
          {!isOwn && !isExpired && !used && <p className="mt-1 font-mono text-[11px] text-fc-muted">{formatCode(rs.code)}</p>}
        </>
      )}
      <p className="mt-2 text-[11px] text-fc-muted">
        {[isExpired ? t('rs.state.expired') : null, used && !isOwn ? t('rs.state.used') : null, state].filter(Boolean).join(' · ') || t('rs.card.e2e')}
      </p>
    </div>
  )
}
