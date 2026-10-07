// API de l'IA sur l'appareil pour l'interface : réglages, téléchargement des modèles
// (confirmé, taille affichée avant), traduction et transcription dans un Worker.
// Le texte et l'audio ne quittent JAMAIS l'appareil : seul le téléchargement des
// modèles (fichiers publics) touche le réseau, vers notre serveur.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import toast from 'react-hot-toast'
import { SERVER_URL } from '../api/client'
import { t } from '../i18n'
import { confirm } from '../components/ui/ConfirmModal'
import { formatBytes } from '../utils/compressImage'
import { downloadPacks, installedPacks, type AiFileError } from './modelStore'
import { isAiLang, packSize, packsFor, planTranslation, type AiLang, type PackId, type Step } from './manifest'
import { detectLang } from './text'
import { stopEngine, transcribePcm, translateSteps } from './engineCore'

export { stopEngine }

export const AI_BASE = `${SERVER_URL}/ai-models/`

interface AiSettings {
  translate: boolean
  transcribe: boolean
  summary: boolean
  /** Langue cible de la traduction ; null = langue de l'interface. */
  target: AiLang | null
  set: (p: Partial<Omit<AiSettings, 'set'>>) => void
}

export const useAiSettings = create<AiSettings>()(persist(
  set => ({ translate: true, transcribe: true, summary: true, target: null, set: p => set(p) }),
  { name: 'fc-ai', storage: createJSONStorage(() => localStorage) },
))

export const targetLang = (uiLang: string): AiLang => {
  const tgt = useAiSettings.getState().target
  return tgt ?? (isAiLang(uiLang) ? uiLang : 'en')
}

// ─── Téléchargement ─────────────────────────────────────────────────────────

let downloading: Promise<void> | null = null

/** Télécharge les packs avec une notification de progression. */
export async function download(ids: PackId[]) {
  if (downloading) await downloading.catch(() => {})
  const id = toast.loading(t('ai.download.progress', { pct: 0 }))
  downloading = downloadPacks(ids, AI_BASE, (done, total) => {
    toast.loading(t('ai.download.progress', { pct: Math.floor((done / Math.max(total, 1)) * 100) }), { id })
  })
  try {
    await downloading
    toast.success(t('ai.download.done'), { id })
  } catch (e) {
    const code = (e as AiFileError).code
    toast.error(code === 'corrupt' ? t('ai.download.corrupt') : t('ai.download.failed'), { id })
    throw e
  } finally {
    downloading = null
  }
}

/** Modèles présents, sinon proposition de téléchargement (taille affichée). false = refusé. */
export async function ensurePacks(ids: PackId[], feature: 'translate' | 'transcribe'): Promise<boolean> {
  const have = await installedPacks()
  const missing = ids.filter(id => !have.has(id))
  if (!missing.length) return true
  const ok = await confirm({
    message: t(feature === 'translate' ? 'ai.confirm.translate' : 'ai.confirm.transcribe', { size: formatBytes(packSize(missing)) }),
    confirmLabel: t('ai.confirm.download'),
  })
  if (!ok) return false
  await download(missing)
  return true
}

// ─── Fonctions ──────────────────────────────────────────────────────────────

export type TranslateResult = { text: string } | { error: 'lang' | 'same' | 'declined' }

export async function translate(text: string, uiLang: string): Promise<TranslateResult> {
  const src = detectLang(text)
  if (!src) return { error: 'lang' }
  const steps: Step[] = planTranslation(src, targetLang(uiLang))
  if (!steps.length) return { error: 'same' }
  if (!(await ensurePacks(packsFor(steps), 'translate'))) return { error: 'declined' }
  return { text: await translateSteps(text, steps) }
}

/** Sous-titres d'appel : modèle présent (ou téléchargé avec accord). */
export const prepareCaptions = () => ensurePacks(['runtime', 'whisper'], 'transcribe').catch(() => false)

/** Audio mono 16 kHz → texte. `ask` = proposer le téléchargement si absent. */
export async function transcribe(pcm: Float32Array, opts: { ask?: boolean; language?: string } = {}): Promise<{ text: string; lang?: string } | null> {
  if (opts.ask !== false) {
    if (!(await ensurePacks(['runtime', 'whisper'], 'transcribe'))) return null
  }
  return transcribePcm(pcm, opts.language)
}
