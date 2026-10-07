// Note privée sur un utilisateur (visible de soi seul, comme Discord), chiffrée sur
// l'appareil avec la clé de compte (e2e/notes.ts), et surnom d'ami
// (/friends/:id/nickname). Enregistrés à la perte du focus.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useAccountKey } from '../e2e/accountKey'
import { loadNote, saveNote } from '../e2e/notes'
import { useT } from '../i18n'

export default function UserPrivateNotes({ userId, isFriend }: { userId: string; isFriend: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const keyStatus = useAccountKey(s => s.status)
  const { data: noteData } = useQuery({
    queryKey: ['user-note', userId, keyStatus],
    queryFn: () => loadNote(userId),
  })
  const { data: nickData } = useQuery<{ nickname: string }>({
    queryKey: ['friend-nickname', userId],
    queryFn: () => api.get(`/friends/${userId}/nickname`).then(r => r.data),
    enabled: isFriend,
  })
  const [note, setNote] = useState('')
  const [nickname, setNickname] = useState('')
  const saved = noteData?.text ?? ''
  useEffect(() => { setNote(saved) }, [saved])
  useEffect(() => { setNickname(nickData?.nickname ?? '') }, [nickData?.nickname])

  const saveNoteNow = () => {
    if (noteData?.locked || note === saved) return
    saveNote(userId, note.slice(0, 2000))
      .then(() => qc.invalidateQueries({ queryKey: ['user-note', userId] }))
      .catch(() => toast.error(t('soc.note.saveError')))
  }
  const saveNickname = () => {
    if (nickname.trim() === (nickData?.nickname ?? '')) return
    api.put(`/friends/${userId}/nickname`, { nickname: nickname.trim() })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['friend-nickname', userId] })
        qc.invalidateQueries({ queryKey: ['friends'] })
      })
      .catch(() => toast.error(t('soc.nick.saveError')))
  }

  return (
    <div className="mb-3 space-y-2">
      {isFriend && (
        <label className="block">
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{t('soc.nick.label')}</span>
          <input
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            onBlur={saveNickname}
            maxLength={64}
            placeholder={t('soc.nick.ph')}
            className="mt-1 w-full px-2 py-1.5 bg-fc-channel rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
          />
        </label>
      )}
      <label className="block">
        <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">🔒 {t('soc.note.label')}</span>
        {noteData?.locked ? (
          <p className="mt-1 text-xs text-fc-muted">{t('soc.note.locked')}</p>
        ) : (
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            onBlur={saveNoteNow}
            maxLength={2000}
            rows={2}
            placeholder={t('soc.note.ph')}
            className="mt-1 w-full px-2 py-1.5 bg-fc-channel rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent resize-none"
          />
        )}
      </label>
    </div>
  )
}
