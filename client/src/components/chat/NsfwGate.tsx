import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'

const KEY = 'fc_nsfw_ok'

function confirmes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Salon 18+ déjà confirmé sur cet appareil ? Renvoie aussi la fonction qui le confirme. */
export function useNsfwOk(channelId: string | undefined): [boolean, () => void] {
  const [liste, setListe] = useState(confirmes)
  const ok = !!channelId && liste.includes(channelId)
  const confirmer = () => {
    if (!channelId) return
    const next = [...new Set([...liste, channelId])].slice(-200)
    setListe(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* stockage indisponible : redemandé plus tard */ }
  }
  return [ok, confirmer]
}

/** Écran de confirmation avant d'entrer dans un salon réservé aux adultes (comme Discord). */
export default function NsfwGate({ name, onConfirm, onBack }: { name: string; onConfirm: () => void; onBack: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-fc-chat p-6">
      <div role="alertdialog" aria-labelledby="nsfw-titre" className="max-w-md text-center space-y-4">
        <ShieldAlert size={48} className="mx-auto text-fc-red" aria-hidden />
        <h2 id="nsfw-titre" className="text-xl font-bold text-white">Salon réservé aux adultes</h2>
        <p className="text-sm text-fc-muted">
          « {name} » peut contenir du contenu réservé aux plus de 18 ans. Confirme que tu es majeur et que tu acceptes de voir ce contenu.
        </p>
        <div className="flex justify-center gap-3">
          <button onClick={onBack} className="px-4 py-2 rounded bg-fc-hover text-white text-sm">Non, retour</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded bg-fc-red text-white text-sm font-medium">J’ai plus de 18 ans, continuer</button>
        </div>
      </div>
    </div>
  )
}
