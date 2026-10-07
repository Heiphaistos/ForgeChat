// Clip d'un stream : aperçu, téléchargement, ou envoi dans un salon texte du serveur.
// Le salon vocal n'a pas de discussion : on propose un salon texte, par défaut le
// premier de la même catégorie que le salon vocal.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Send, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { clipExtension } from '../../lib/clipBuffer'
import { useT } from '../../i18n'
import { channelSendError, postMessage } from '../../e2e/channels'
import { filesExtra, prepareFiles, uploadPrepared } from '../../e2e/files'

const MAX_SIZE = 500 * 1024 * 1024 // = server/src/config.rs, comme MessageInput

interface Channel { id: string; name: string; type: string; category_id?: string | null }

export default function ClipDialog({ blob, label, serverId, voiceChannelId, onClose }: {
  blob: Blob; label: string; serverId: string; voiceChannelId: string; onClose: () => void
}) {
  const t = useT()
  useEscapeKey(onClose)
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  const filename = `clip-${label}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${clipExtension(blob)}`
    .replace(/[^\w.-]+/g, '_')

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['server-channels-clip', serverId],
    queryFn: () => api.get(`/servers/${serverId}/channels`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })
  const textChannels = channels.filter(c => c.type === 'text')
  const category = channels.find(c => c.id === voiceChannelId)?.category_id
  const [target, setTarget] = useState('')
  const chosen = target || (textChannels.find(c => category && c.category_id === category) ?? textChannels[0])?.id || ''
  const [sending, setSending] = useState(false)

  const download = () => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // Même chemin que les messages vocaux : message puis pièce jointe.
  const send = async () => {
    if (!chosen) return
    if (blob.size > MAX_SIZE) { toast.error(t('clip.tooBig')); return }
    setSending(true)
    try {
      // Salon chiffré : légende ET clip chiffrés (clé du clip dans le message chiffré, §12).
      const prepared = await prepareFiles('channel', chosen, [{ file: new File([blob], filename, { type: blob.type }) }])
      const res = await postMessage(serverId, chosen, `🎬 ${t('clip.title', { name: label })}`,
        body => api.post(`/servers/${serverId}/channels/${chosen}/messages`, body), filesExtra(prepared))
      await uploadPrepared(`/servers/${serverId}/channels/${chosen}/messages/${res.data.id}/attachments`, prepared)
      toast.success(t('clip.sent'))
      onClose()
    } catch (e) {
      toast.error(channelSendError(e, t('clip.sendError')))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('clip.dialog')} onClick={e => e.stopPropagation()}
        className="w-full max-w-lg bg-fc-sidebar rounded-xl border border-fc-hover p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm truncate">{t('clip.title', { name: label })}</h3>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1.5 rounded hover:bg-white/10 text-fc-muted hover:text-white"><X size={16} aria-hidden /></button>
        </div>
        <video src={url} controls playsInline className="w-full max-h-72 bg-black rounded-lg" />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={download} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fc-hover hover:bg-fc-channel text-white text-sm">
            <Download size={14} aria-hidden /> {t('settings.privacy.download')}
          </button>
          {serverId && textChannels.length > 0 && (
            <>
              <select value={chosen} onChange={e => setTarget(e.target.value)} aria-label={t('clip.channel')}
                className="flex-1 min-w-0 bg-fc-channel border border-fc-hover rounded-lg px-2 py-1.5 text-sm text-white">
                {textChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </select>
              <button onClick={send} disabled={sending || !chosen}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fc-accent hover:bg-fc-accent/80 disabled:opacity-50 text-white text-sm">
                <Send size={14} aria-hidden /> {sending ? t('common.sending') : t('friends.send')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
