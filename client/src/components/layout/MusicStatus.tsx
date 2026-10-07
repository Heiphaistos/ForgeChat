// « J'écoute… » saisi à la main (lot « Profil et social ») : activité `listening`,
// visible selon le réglage « activité » (tout le monde / amis / personne).
import { useState } from 'react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import { useT } from '../../i18n'

export default function MusicStatus() {
  const t = useT()
  const { user, updateMe } = useAuth()
  const listening = user?.activity_type === 'listening' ? user.activity_name ?? '' : ''
  const [text, setText] = useState(listening)
  const [saving, setSaving] = useState(false)

  const save = async (value: string) => {
    setSaving(true)
    try {
      const v = value.trim()
      const patch = v ? { activity_type: 'listening', activity_name: v } : { activity_type: '' }
      await api.patch('/users/me', patch)
      updateMe(v ? patch : { activity_type: null, activity_name: null })
      if (v) toast.success(t('soc.music.saved'))
    } catch {
      toast.error(t('soc.groups.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
      <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide">🎵 {t('soc.music.title')}</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={t('soc.music.ph')}
          maxLength={100}
          enterKeyHint="send"
          autoComplete="off"
          aria-label={t('soc.music.title')}
          className="flex-1 fc-input text-xs py-1"
          onKeyDown={e => { if (e.key === 'Enter') void save(text) }}
        />
        <button onClick={() => void save(text)} disabled={saving || !text.trim()} className="btn-primary text-xs px-2 py-1 disabled:opacity-50">
          {t('soc.music.set')}
        </button>
        {listening && (
          <button onClick={() => { setText(''); void save('') }} disabled={saving}
            className="px-2 py-1 text-xs rounded bg-fc-hover text-fc-muted hover:text-white transition disabled:opacity-50">
            {t('soc.music.clear')}
          </button>
        )}
      </div>
      <p className="text-[10px] text-fc-muted">{t('soc.music.hint')}</p>
    </div>
  )
}
