// Support à distance natif (GhostHandDesk) dans un MP : bouton d'en-tête et carte de message.
// L'identifiant et le code partent dans le contenu chiffré de bout en bout (`rs`), jamais en clair.
import { useEffect, useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useChat } from '../../store/chat'
import { useAuth } from '../../store/auth'
import { useT, t as tr, type Key } from '../../i18n'
import type { ContextMenuItem } from '../ui/ContextMenu'
import { confirm } from '../ui/ConfirmModal'
import {
  GHD_WINDOWS_DOWNLOAD, canHostGhd, connectLink, ghdLaunchArgs, expired, formatCode, formatId, invite, isDeviceId, newCode, parseSupport,
  shareLink, webViewerLink, type SupportPayload,
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
/** Partager son écran (être aidé) : agent GhostHandDesk, Windows seulement. Aider : partout (visionneuse web). */
// L'appli de bureau a son propre user-agent (« ForgeChat/x (Desktop) », sans « Windows NT ») :
// on y demande la plateforme au système. ponytail: lu au chargement du module ; un rendu avant
// la réponse (quelques ms) voit « non », sans effet tant que le menu n'est pas ouvert.
let canHost = !isTauri && canHostGhd(typeof navigator === 'undefined' ? '' : navigator.userAgent)
if (isTauri) {
  void tauri<{ platform?: string }>('system_get')
    .then(s => { canHost = s.platform === 'windows' })
    .catch(e => console.warn('[remoteSupport] system_get', e))
}
const ID_KEY = 'fc_ghd_id'
const savedId = () => { try { return localStorage.getItem(ID_KEY) ?? '' } catch { return '' } }

/**
 * Support à distance réservé aux amis acceptés : c'est le scénario type de l'arnaque au faux
 * support. Le contenu étant chiffré de bout en bout, la règle s'applique ici, pas au serveur.
 */
const fetchRelationship = (userId: string) =>
  api.get(`/users/${userId}/profile`).then(r => (r.data?.relationship as string | undefined) ?? 'none')

function useIsFriend(userId: string | undefined): boolean | undefined {
  const { data } = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.get(`/users/${userId}/profile`).then(r => r.data),
    enabled: !!userId,
    staleTime: 30_000,
  })
  if (!userId) return false
  return data === undefined ? undefined : data?.relationship === 'friend'
}

/** Correspondant d'un MP (infos déjà chargées par DMPage). */
function usePartner(dmId: string): string | undefined {
  const qc = useQueryClient()
  return qc.getQueryData<{ other_user_id?: string } | null>(['dm_info', dmId])?.other_user_id ?? undefined
}

async function tauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/**
 * Page https (visionneuse web, téléchargement) : onglet du navigateur, ou navigateur du système
 * depuis l'appli de bureau (qui refuse les nouvelles fenêtres). Navigateur : à appeler dans le
 * clic lui-même (aucun `await` avant), sinon la fenêtre est bloquée comme popup.
 */
async function openWeb(url: string) {
  if (!url.startsWith('https://')) return
  if (!isTauri) { window.open(url, '_blank', 'noopener,noreferrer'); return }
  await tauri('plugin:shell|open', { path: url }).catch(() => toast.error(tr('rs.openFailed')))
}

/**
 * Lance GhostHandDesk par un lien `ghosthanddesk://`, avec toujours un retour visible : un lien
 * sans appli inscrite est ignoré en silence par le navigateur, et échoue (ou n'aboutit à rien)
 * dans l'appli de bureau. Retour : true = lancé, false = absent ou lien refusé, null = annulé
 * dans la boîte de confirmation du bureau.
 */
async function launchGhd(url: string, missing: Key = 'rs.notInstalled'): Promise<boolean | null> {
  const args = ghdLaunchArgs(url)
  if (!args) return false
  if (isTauri) {
    // L'appli de bureau valide le lien, demande confirmation et lance GhostHandDesk (ghd_launch) :
    // false = annulé par l'utilisateur ; erreur = absent (ou ancienne appli sans la commande).
    const launched = await tauri<boolean>('ghd_launch', args).then(ok => (ok ? 'ok' : 'cancelled'), () => 'missing')
    if (launched === 'cancelled') return null // annulé : ni toast, ni repli web
    if (launched === 'missing') { toast.error(tr(missing), { id: 'ghd', duration: 8000 }); return false }
  } else {
    window.location.href = url
  }
  toast(tr('rs.opening'), { id: 'ghd', duration: 8000 })
  return true
}

async function send(dmId: string, rs: SupportPayload) {
  const s = senders.get(dmId)
  if (!s) return
  // L'échec de l'envoi lui-même est signalé par la mutation d'envoi du MP.
  try { await s(rs) } catch { /* déjà signalé */ }
}

/** Code armé dans GhostHandDesk (le lien `share` ouvre l'appli, qui affiche l'identifiant). */
interface Armed { code: string; at: number }
function arm(code = newCode()): Armed {
  void launchGhd(shareLink(code))
  return { code, at: Date.now() }
}

/** Hôte : envoie l'invitation (identifiant + code déjà armé) chiffrée. */
async function startHosting(dmId: string, id: string, armed: Armed, ref?: string) {
  try { localStorage.setItem(ID_KEY, id) } catch { /* préférence non mémorisée */ }
  await send(dmId, invite(id, armed.code, armed.at, ref))
}

/**
 * Personne aidée : GhostHandDesk vient d'être lancé avec un code ; elle recopie l'identifiant
 * qu'il affiche. Sans GhostHandDesk : téléchargement direct, puis relance automatique au
 * retour dans ForgeChat. `armed` null = pas Windows, partage impossible : on l'explique.
 */
function HostSetup({ armed: first, onSubmit, onCancel }: { armed: Armed | null; onSubmit: (id: string, armed: Armed) => void; onCancel: () => void }) {
  const t = useT()
  const [armed, setArmed] = useState(first)
  const [downloadedAt, setDownloadedAt] = useState(0)
  const code = armed?.code
  useEffect(() => {
    if (!downloadedAt || !code) return
    // Retour dans ForgeChat après avoir lancé le fichier téléchargé (pas le simple aller-retour de l'onglet).
    const retry = () => { if (Date.now() - downloadedAt > 5000) { setDownloadedAt(0); setArmed(arm(code)) } }
    window.addEventListener('focus', retry)
    return () => window.removeEventListener('focus', retry)
  }, [downloadedAt, code])
  const btn = 'rounded px-3 py-1.5 text-xs font-medium transition'
  if (!armed) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-fc-text">{t('rs.windowsOnly')}</p>
        <button type="button" onClick={onCancel} className={`${btn} text-fc-muted hover:text-white`}>{t('rs.cancel')}</button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-fc-text">{t('rs.hostSteps')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${btn} bg-fc-hover text-white`} onClick={() => setArmed(arm(armed.code))}>{t('rs.rearm')}</button>
        <button type="button" className={`${btn} text-fc-accent hover:underline`}
          onClick={() => { void openWeb(GHD_WINDOWS_DOWNLOAD); setDownloadedAt(Date.now()) }}>{t('rs.download')}</button>
      </div>
      <IdForm onCancel={onCancel} onSubmit={id => onSubmit(id, armed)} />
    </div>
  )
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
      fetchRelationship(userId)
        .then(rel => {
          if (rel !== 'friend') { toast.error(tr('rs.friendsOnly')); return }
          return api.post(`/dms/${userId}`).then(r => nav(`/dms/${r.data.dm_id}?support=1`))
        })
        .catch(() => toast.error(tr('msg.openDmFailed')))
    },
  }
}

/** Bouton du MP (en-tête, ou barre d'appel avec `round`) : « Aider » ou « Demander de l'aide ». */
export function RemoteSupportButton({ dmId, autoOpen = false, round = false }: { dmId: string; autoOpen?: boolean; round?: boolean }) {
  const friend = useIsFriend(usePartner(dmId))
  if (!friend) return null
  return <RemoteSupportMenu dmId={dmId} autoOpen={autoOpen} round={round} />
}

function RemoteSupportMenu({ dmId, autoOpen, round }: { dmId: string; autoOpen: boolean; round: boolean }) {
  const t = useT()
  const [open, setOpen] = useState<null | 'menu' | 'host'>(null)
  const [armed, setArmed] = useState<Armed | null>(null)
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
              <button className="rounded px-2 py-2 text-left text-sm text-fc-text hover:bg-fc-hover" onClick={() => { setArmed(canHost ? arm() : null); setOpen('host') }}>{t('rs.ask')}</button>
            </div>
          ) : (
            <HostSetup armed={armed} onCancel={() => setOpen(null)} onSubmit={(id, a) => { setOpen(null); void startHosting(dmId, id, a) }} />
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
  // Offre acceptée : panneau hôte (false = fermé, null = pas Windows).
  const [host, setHost] = useState<Armed | null | false>(false)
  const [used, setUsed] = useState(() => wasUsed(cmid))
  // Reçu d'un non-ami : affiché, jamais actionnable (pas d'ouverture de GhostHandDesk ni de code).
  const friend = useIsFriend(isOwn ? undefined : msg.author_id) ?? false
  const actionable = isOwn || friend
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

  // Aidant : visionneuse web (partout, sans installation) ou appli ; appli absente = visionneuse web.
  const join = (how: 'app' | 'web') => {
    if (!rs.id || !rs.code) return
    try { localStorage.setItem(usedKey(cmid), '1') } catch { /* usage unique garanti par GhostHandDesk */ }
    setUsed(true)
    const web = webViewerLink(rs.id, rs.code)
    if (how === 'web') void openWeb(web)
    else void launchGhd(connectLink(rs.id, rs.code), 'rs.webFallback').then(ok => { if (ok === false) void openWeb(web) })
    if (!reply) send(dmId, { v: 1, k: 'accept', ref: cmid })
  }
  // Personne aidée : confirmation (dans l'appli : confirm() natif est muet sous macOS), puis GhostHandDesk.
  const acceptOffer = async () => {
    if (!canHost) { setHost(null); return }
    if (await confirm({ message: t('rs.confirmOpen', { name }), confirmLabel: t('rs.openGhd'), cancelLabel: t('rs.cancel') })) setHost(arm())
  }

  return (
    <div className="mt-1.5 max-w-md rounded-lg border border-fc-accent/40 bg-fc-accent/5 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 font-semibold text-white"><LifeBuoy size={16} className="text-fc-accent" aria-hidden />{t('rs.card.title')}</div>
      {rs.k === 'offer' && (
        <>
          <p className="text-fc-text">{t(isOwn ? 'rs.card.offerOut' : 'rs.card.offerIn', { name })}</p>
          {!isOwn && !reply && <p className="mt-1 text-[11px] font-medium text-fc-yellow">{t('rs.scam')}</p>}
          {!isOwn && !actionable && <p className="mt-1 text-xs text-fc-muted">{t('rs.friendsOnly')}</p>}
          {!isOwn && actionable && !reply && host === false && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={`${btn} bg-fc-accent text-white`} onClick={() => void acceptOffer()}>{t('rs.accept')}</button>
              <button className={`${btn} text-fc-muted hover:text-white`} onClick={() => send(dmId, { v: 1, k: 'decline', ref: cmid })}>{t('rs.decline')}</button>
            </div>
          )}
          {host !== false && !reply && <div className="mt-2"><HostSetup armed={host} onCancel={() => setHost(false)} onSubmit={(id, a) => { setHost(false); void startHosting(dmId, id, a, cmid) }} /></div>}
        </>
      )}
      {rs.k === 'invite' && rs.id && rs.code && (
        <>
          <p className="text-fc-text">{t(isOwn ? 'rs.card.inviteOut' : 'rs.card.inviteIn', { name, id: formatId(rs.id), time })}</p>
          {isOwn ? (
            !isExpired && reply?.k !== 'decline' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button className={`${btn} bg-fc-hover text-white`} onClick={() => void launchGhd(shareLink(rs.code!, Math.max(60, Math.round(((rs.exp ?? 0) - Date.now()) / 1000))))}>{t('rs.rearm')}</button>
                <button className={`${btn} text-fc-accent hover:underline`} onClick={() => void openWeb(GHD_WINDOWS_DOWNLOAD)}>{t('rs.download')}</button>
                <span className="w-full text-[11px] text-fc-muted">{t('rs.portable')}</span>
              </div>
            )
          ) : !actionable ? (
            <p className="mt-1 text-xs text-fc-muted">{t('rs.friendsOnly')}</p>
          ) : !isExpired && !used && reply?.k !== 'decline' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={`${btn} bg-fc-accent text-white`} onClick={() => join('web')}>{t('rs.openWeb')}</button>
              {canHost && <button className={`${btn} bg-fc-hover text-white`} onClick={() => join('app')}>{t('rs.openApp')}</button>}
              {!reply && <button className={`${btn} text-fc-muted hover:text-white`} onClick={() => send(dmId, { v: 1, k: 'decline', ref: cmid })}>{t('rs.decline')}</button>}
            </div>
          )}
          {!isOwn && actionable && !isExpired && !used && <p className="mt-1 font-mono text-[11px] text-fc-muted">{formatCode(rs.code)}</p>}
        </>
      )}
      <p className="mt-2 text-[11px] text-fc-muted">
        {[isExpired ? t('rs.state.expired') : null, used && !isOwn ? t('rs.state.used') : null, state].filter(Boolean).join(' · ') || t('rs.card.e2e')}
      </p>
    </div>
  )
}
