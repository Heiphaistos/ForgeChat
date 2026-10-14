// Réglages d'un salon forum / média : réaction par défaut et consignes de publication.
// PATCH …/forum-settings (droit de modifier les salons) ; seuls les champs changés partent.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT } from '../../i18n'
import { forumSettingsPatch } from '../../lib/discordFeatures'

interface Props {
  serverId: string
  channel: { id: string; default_reaction_emoji?: string | null; post_guidelines?: string | null }
}

export default function ForumSettingsSection({ serverId, channel }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [emoji, setEmoji] = useState(channel.default_reaction_emoji ?? '')
  const [rules, setRules] = useState(channel.post_guidelines ?? '')
  // Dernière valeur enregistrée : la modale garde l'objet salon d'ouverture.
  const [saved, setSaved] = useState({ default_reaction_emoji: channel.default_reaction_emoji, post_guidelines: channel.post_guidelines })
  const patch = forumSettingsPatch(saved, { default_reaction_emoji: emoji, post_guidelines: rules })
  const dirty = Object.keys(patch).length > 0

  const save = useMutation({
    mutationFn: () => api.patch(`/servers/${serverId}/channels/${channel.id}/forum-settings`, patch).then(r => r.data),
    onSuccess: (d: { default_reaction_emoji: string | null; post_guidelines: string | null }) => {
      setSaved({ default_reaction_emoji: d.default_reaction_emoji, post_guidelines: d.post_guidelines })
      setEmoji(d.default_reaction_emoji ?? '')
      setRules(d.post_guidelines ?? '')
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success(t('dfeat.forum.saved'))
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  return (
    <div className="space-y-3 bg-fc-bg/50 rounded-xl border border-fc-hover p-4">
      <h4 className="text-sm font-semibold text-white">{t('dfeat.forum.title')}</h4>
      <div>
        <label htmlFor="forum-default-emoji" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">{t('dfeat.forum.emoji')}</label>
        <input id="forum-default-emoji" value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={64}
          placeholder="👍" autoComplete="off" aria-describedby="forum-default-emoji-hint"
          className="w-40 px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm" />
        <p id="forum-default-emoji-hint" className="text-xs text-fc-muted mt-1">{t('dfeat.forum.emojiHint')}</p>
      </div>
      <div>
        <label htmlFor="forum-guidelines" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
          {t('dfeat.forum.guidelines')} <span className="ml-1 normal-case font-normal">({rules.length}/2000)</span>
        </label>
        <textarea id="forum-guidelines" value={rules} onChange={e => setRules(e.target.value)} maxLength={2000} rows={4}
          placeholder={t('dfeat.forum.guidelinesPh')}
          className="w-full px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-y" />
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}
          className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition disabled:opacity-50">
          {save.isPending ? t('common.recording') : t('dfeat.forum.save')}
        </button>
      </div>
    </div>
  )
}
