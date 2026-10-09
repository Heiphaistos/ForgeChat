// IA sur l'appareil côté appli : réglages (gardés sur ce téléphone) et actions
// « Traduire » / « Transcrire ». Téléchargement des modèles proposé avec sa taille.
import { Alert } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { secureStateStorage } from '@/lib/secureStorage'
import { formatBytes } from '@/lib/format'
import { t, useLang, type Key } from '@/i18n'
import type { AiLang } from '@/lib/ai/text'
import { aiCall, downloadPacks, type AiReply } from './bridge'

export const AI_LANGS: AiLang[] = ['fr', 'en', 'es', 'de', 'it', 'pt']

interface AiSettings {
  translate: boolean
  transcribe: boolean
  summary: boolean
  /** Vocaux transcrits par Whisper small (précis, ~250 Mo) plutôt que base (rapide, ~80 Mo). */
  precise: boolean
  /** Langue cible ; null = langue de l'interface. */
  target: AiLang | null
  set: (p: Partial<Omit<AiSettings, 'set'>>) => void
}

export const useAiSettings = create<AiSettings>()(
  persist((set) => ({ translate: true, transcribe: true, summary: true, precise: true, target: null, set: (p) => set(p) }), {
    name: 'fc.ai.v1',
    storage: createJSONStorage(() => secureStateStorage),
    partialize: ({ set: _s, ...rest }) => rest,
  }),
)

const ask = (message: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(t('ai.title'), message, [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('ai.confirm.download'), onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  )

/** Demande au moteur ; modèles absents : proposition de téléchargement (taille), puis nouvel essai. */
async function withModels(req: Record<string, unknown> & { op: string }, confirmKey: Key): Promise<AiReply | null> {
  const r = await aiCall(req)
  if (r.error !== 'missing' || !r.packs) return r
  if (!(await ask(t(confirmKey, { size: formatBytes(r.size ?? 0) })))) return null
  if (!(await downloadPacks(r.packs))) {
    Alert.alert(t('ai.title'), t('ai.download.failed'))
    return null
  }
  return aiCall(req)
}

/** Texte traduit sur le téléphone, ou null (refusé, déjà dans la langue, échec signalé). */
export async function translateOnDevice(text: string): Promise<string | null> {
  const target = useAiSettings.getState().target ?? useLang.getState().lang
  const r = await withModels({ op: 'translate', text, target }, 'ai.confirm.translate')
  if (!r) return null
  if (r.ok && typeof r.text === 'string') return r.text
  Alert.alert(t('ai.title'), t(r.error === 'lang' ? 'ai.err.lang' : r.error === 'same' ? 'ai.err.same' : 'ai.err.failed'))
  return null
}

/** Message vocal (déjà déchiffré, en base64) transcrit sur le téléphone. */
export async function transcribeOnDevice(audio: string, mime: string): Promise<string | null> {
  const r = await withModels({ op: 'transcribe', audio, mime, precise: useAiSettings.getState().precise }, 'ai.confirm.transcribe')
  if (!r) return null
  if (r.ok && typeof r.text === 'string') return r.text
  Alert.alert(t('ai.title'), t('ai.transcribeFailed'))
  return null
}
