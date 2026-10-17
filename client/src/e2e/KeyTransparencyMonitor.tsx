// Surveillance du journal de transparence (amélioration n° 10) : au démarrage puis toutes les
// 6 heures, une fois la clé de compte ouverte. Problème : alerte persistante, jamais silencieuse.
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useAuth } from '../store/auth'
import { t } from '../i18n'
import { useAccountKey } from './accountKey'
import { loadMonitorState, monitor, type KtEntry, type KtHead, type MonitorState } from './keyTransparency'

const EVERY_MS = 6 * 3600_000
const storeKey = (uid: string) => `fc_kt_${uid}`

function save(uid: string, s: MonitorState) {
  try { localStorage.setItem(storeKey(uid), JSON.stringify(s)) } catch { /* sans mémoire : reprise depuis le début */ }
}

export async function runKeyTransparencyCheck(uid: string, pub: string): Promise<void> {
  const fetchPage = async (after: number) =>
    (await api.get<{ entries: KtEntry[]; head: KtHead | null }>('/keys/log', { params: { after, limit: 1000 } })).data
  const r = await monitor(loadMonitorState(uid), uid, pub, fetchPage)
  if (r.status === 'ok') return save(uid, r.state)
  toast.error(t(r.status === 'rewritten' ? 'guard.kt.rewritten' : 'guard.kt.foreign'), { id: 'kt-alert', duration: Infinity })
}

export default function KeyTransparencyMonitor() {
  const uid = useAuth(s => s.user?.id)
  const pub = useAccountKey(s => (s.status === 'ready' ? s.pub : null))
  useEffect(() => {
    if (!uid || !pub) return
    const run = () => { runKeyTransparencyCheck(uid, pub).catch(() => { /* réseau : prochain passage */ }) }
    const first = window.setTimeout(run, 5000)
    const timer = window.setInterval(run, EVERY_MS)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [uid, pub])
  return null
}
