// « Transcrire » sous un message vocal : le son déjà déchiffré est décodé et transcrit
// par Whisper SUR L'APPAREIL (src/ai). Rien n'est envoyé.
import { useState } from 'react'
import { FileAudio, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { transcribe, useAiSettings } from '../../ai/engine'
import { decodeToPcm } from '../../ai/audio'

// `load` rend le fichier déjà déchiffré (pas de fetch d'une adresse blob:, que la CSP connect-src bloque).
export default function TranscribeButton({ load }: { load: () => Promise<Blob> }) {
  const t = useT()
  const enabled = useAiSettings(s => s.transcribe)
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!enabled) return null

  const run = async () => {
    setBusy(true)
    try {
      const pcm = await decodeToPcm(await load())
      const r = await transcribe(pcm)
      if (r !== null) setText(r.text)
    } catch {
      toast.error(t('ai.transcribeFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (text !== null) {
    return (
      <div className="mt-1 px-2 py-1.5 bg-fc-accent/10 border-l-2 border-fc-accent rounded text-sm text-fc-text max-w-md">
        <span className="text-xs text-fc-accent font-medium mr-1.5">{t('ai.transcript')}</span>
        <span className="whitespace-pre-wrap">{text || '…'}</span>
      </div>
    )
  }
  return (
    <button type="button" onClick={() => void run()} disabled={busy}
      className="mt-1 flex items-center gap-1.5 text-xs text-fc-muted hover:text-fc-accent disabled:opacity-60">
      {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <FileAudio size={12} aria-hidden />}
      {busy ? t('ai.transcribing') : t('ai.transcribe')}
    </button>
  )
}
