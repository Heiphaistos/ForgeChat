import { useState } from 'react'
import { X, CalendarClock } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  channelId: string
  serverId: string
  content: string
  onClose: () => void
}

export default function ScheduleMessageModal({ channelId, serverId, content, onClose }: Props) {
  const [scheduledFor, setScheduledFor] = useState('')
  const qc = useQueryClient()

  const minDateTime = new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16)

  const schedule = useMutation({
    mutationFn: ({ body, isoDate }: { body: string; isoDate: string }) =>
      api.post(`/servers/${serverId}/channels/${channelId}/messages`, {
        content: body,
        scheduled_for: isoDate,
      }),
    onSuccess: (_res, vars) => {
      const label = format(new Date(vars.isoDate), "dd/MM/yyyy 'à' HH:mm", { locale: fr })
      toast.success(`Message planifié pour ${label}`)
      qc.invalidateQueries({ queryKey: ['scheduled_messages', serverId, channelId] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur lors de la planification'),
  })

  const handleSubmit = () => {
    if (!content.trim()) { toast.error('Message vide'); return }
    if (!scheduledFor) { toast.error('Choisissez une date et une heure'); return }
    const iso = new Date(scheduledFor).toISOString()
    schedule.mutate({ body: content.trim(), isoDate: iso })
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-fc-channel rounded-xl w-[420px] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-fc-hover">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-fc-accent" />
            <h2 className="font-semibold text-white text-sm">Programmer l'envoi</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Aperçu du message */}
          <div>
            <p className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              Message à envoyer
            </p>
            <div className="bg-fc-input rounded-lg px-3 py-2.5 text-sm text-fc-text line-clamp-3">
              {content.trim() || <span className="text-fc-muted italic">Message vide</span>}
            </div>
          </div>

          {/* Sélecteur date/heure */}
          <div>
            <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide block mb-1.5">
              Date et heure d'envoi
            </label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={e => setScheduledFor(e.target.value)}
              min={minDateTime}
              className="w-full px-3 py-2 bg-fc-input border border-fc-hover rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent focus:border-transparent"
            />
            <p className="text-xs text-fc-muted mt-1">Minimum : maintenant + 5 minutes</p>
          </div>

          {/* Confirmation date formatée */}
          {scheduledFor && (
            <div className="flex items-center gap-2 bg-fc-accent/10 border border-fc-accent/20 rounded-lg px-3 py-2">
              <CalendarClock size={14} className="text-fc-accent flex-shrink-0" />
              <span className="text-sm text-white">
                Envoi prévu le{' '}
                <strong>
                  {format(new Date(scheduledFor), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
                </strong>
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={schedule.isPending || !content.trim() || !scheduledFor}
            className="px-4 py-2 text-sm bg-fc-accent hover:bg-indigo-500 text-white rounded-lg font-medium transition disabled:opacity-40"
          >
            {schedule.isPending ? 'Planification...' : 'Planifier l\'envoi'}
          </button>
        </div>
      </div>
    </div>
  )
}
