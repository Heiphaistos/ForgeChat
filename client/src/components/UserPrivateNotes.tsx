// Note privée sur un utilisateur (/notes/:id, visible de soi seul, comme Discord)
// et surnom d'ami (/friends/:id/nickname). Enregistrés à la perte du focus.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../api/client'

export default function UserPrivateNotes({ userId, isFriend }: { userId: string; isFriend: boolean }) {
  const qc = useQueryClient()
  const { data: noteData } = useQuery<{ content: string }>({
    queryKey: ['user-note', userId],
    queryFn: () => api.get(`/notes/${userId}`).then(r => r.data),
  })
  const { data: nickData } = useQuery<{ nickname: string }>({
    queryKey: ['friend-nickname', userId],
    queryFn: () => api.get(`/friends/${userId}/nickname`).then(r => r.data),
    enabled: isFriend,
  })
  const [note, setNote] = useState('')
  const [nickname, setNickname] = useState('')
  useEffect(() => { setNote(noteData?.content ?? '') }, [noteData?.content])
  useEffect(() => { setNickname(nickData?.nickname ?? '') }, [nickData?.nickname])

  const saveNote = () => {
    if (note === (noteData?.content ?? '')) return
    api.put(`/notes/${userId}`, { content: note.slice(0, 2000) })
      .then(() => qc.invalidateQueries({ queryKey: ['user-note', userId] }))
      .catch(() => toast.error("Impossible d'enregistrer la note"))
  }
  const saveNickname = () => {
    if (nickname.trim() === (nickData?.nickname ?? '')) return
    api.put(`/friends/${userId}/nickname`, { nickname: nickname.trim() })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['friend-nickname', userId] })
        qc.invalidateQueries({ queryKey: ['friends'] })
      })
      .catch(() => toast.error("Impossible d'enregistrer le surnom"))
  }

  return (
    <div className="mb-3 space-y-2">
      {isFriend && (
        <label className="block">
          <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Surnom d'ami</span>
          <input
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            onBlur={saveNickname}
            maxLength={64}
            placeholder="Visible par vous seul"
            className="mt-1 w-full px-2 py-1.5 bg-fc-channel rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
          />
        </label>
      )}
      <label className="block">
        <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Note</span>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={saveNote}
          maxLength={2000}
          rows={2}
          placeholder="Cliquez pour ajouter une note"
          className="mt-1 w-full px-2 py-1.5 bg-fc-channel rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent resize-none"
        />
      </label>
    </div>
  )
}
