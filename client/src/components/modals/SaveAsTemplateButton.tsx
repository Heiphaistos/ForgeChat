// « Enregistrer comme modèle » : instantané des salons, catégories et rôles du
// serveur (POST /servers/:id/template, réservé au propriétaire côté serveur),
// réutilisable ensuite à la création d'un serveur (onglet « Mes modèles »).
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LayoutTemplate } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'

export default function SaveAsTemplateButton({ serverId, serverName }: { serverId: string; serverName: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(serverName)
  const save = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/template`, { name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server-templates'] })
      toast.success('Modèle enregistré')
      setOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Impossible d'enregistrer le modèle"),
  })
  const valid = name.trim().length >= 2 && name.trim().length <= 100

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-2 py-1.5 rounded text-sm text-fc-muted hover:text-white hover:bg-fc-hover/50 transition flex items-center gap-2 mb-1"
      >
        <LayoutTemplate size={14} /> Enregistrer comme modèle
      </button>
    )
  }
  return (
    <form
      className="px-2 py-1.5 space-y-1.5 mb-1"
      onSubmit={e => { e.preventDefault(); if (valid) save.mutate() }}
    >
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        maxLength={100}
        autoFocus
        aria-label="Nom du modèle"
        className="w-full px-2 py-1 bg-fc-input rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
      />
      <div className="flex gap-1.5">
        <button type="submit" disabled={!valid || save.isPending} className="px-2 py-1 text-xs bg-fc-accent hover:bg-indigo-500 text-white rounded disabled:opacity-50">
          Enregistrer
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-xs text-fc-muted hover:text-white">
          Annuler
        </button>
      </div>
    </form>
  )
}
