// Surveillance du journal de transparence (amélioration n° 10), comme le web : au démarrage puis
// toutes les 6 heures, une fois la clé de compte ouverte. Problème : alerte, jamais silencieuse.
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { t } from '@/i18n'
import { http } from '@/lib/http'
import { secureStateStorage } from '@/lib/secureStorage'
import { useAuth } from '@/stores/auth'
import { useAccountKey } from './accountKey'
import { monitor, type KtEntry, type KtHead, type MonitorState } from './keyTransparency'

const EVERY_MS = 6 * 3600_000
const storeKey = (uid: string) => `fc_kt_${uid}`

async function load(uid: string): Promise<MonitorState | null> {
  try { return JSON.parse(((await secureStateStorage.getItem(storeKey(uid))) as string | null) ?? 'null') } catch { return null }
}

export async function runKeyTransparencyCheck(uid: string, pub: string): Promise<void> {
  const fetchPage = (after: number) =>
    http.get<{ entries: KtEntry[]; head: KtHead | null }>('/keys/log', { query: { after, limit: 1000 } })
  const r = await monitor(await load(uid), uid, pub, fetchPage)
  if (r.status === 'ok') {
    await secureStateStorage.setItem(storeKey(uid), JSON.stringify(r.state))
    return
  }
  Alert.alert(t('e2e.safety.title'), t(r.status === 'rewritten' ? 'guard.kt.rewritten' : 'guard.kt.foreign'))
}

export function KeyTransparencyMonitor() {
  const uid = useAuth((s) => s.user?.id)
  const pub = useAccountKey((s) => (s.status === 'ready' ? s.pub : null))
  useEffect(() => {
    if (!uid || !pub) return
    const run = () => { runKeyTransparencyCheck(uid, pub).catch(() => undefined) }
    const first = setTimeout(run, 5000)
    const timer = setInterval(run, EVERY_MS)
    return () => { clearTimeout(first); clearInterval(timer) }
  }, [uid, pub])
  return null
}
