// Volume d'une personne (0 à 200 %), ouvert depuis un clic droit ou un bouton : salon vocal,
// barre latérale, appel MP ou de groupe. Un seul réglage par utilisateur (fc_user_volumes),
// appliqué partout où on l'entend (lib/voicePlayback).
import { create } from 'zustand'
import VolumeSlider from './VolumeSlider'
import { useVoice } from '../../store/voice'
import { useAuth } from '../../store/auth'
import { t } from '../../i18n'
import type { ContextMenuCustom } from '../ui/ContextMenu'

interface Target { userId: string; username: string; x: number; y: number }

export const useUserVolume = create<{ target: Target | null; open(t: Target): void; close(): void }>(set => ({
  target: null,
  open: target => set({ target }),
  close: () => set({ target: null }),
}))

/** Ouvre le réglage à l'endroit du clic (ou en bas à gauche sans coordonnées). */
export function openUserVolume(userId: string, username: string, e?: { clientX: number; clientY: number }) {
  useUserVolume.getState().open({ userId, username, x: e?.clientX ?? 16, y: e?.clientY ?? window.innerHeight - 200 })
}

/** Curseur « Volume de l'utilisateur » dans le menu contextuel (0 à 200 %, même réglage que la popover). */
function InlineVolume({ userId, username }: { userId: string; username: string }) {
  const volume = useVoice(s => s.userVolumes[userId] ?? 100)
  const setUserVolume = useVoice(s => s.setUserVolume)
  const pct = Math.round(volume)
  return (
    <label className="block text-sm text-fc-text">
      <span className="flex items-center justify-between mb-1.5">
        <span>{t('um.userVolume')}</span>
        <span className="text-xs font-mono text-fc-muted">{pct}%</span>
      </span>
      <input type="range" min={0} max={200} step={1} value={volume}
        aria-label={t('voice.tile.volumeOf', { name: username })} aria-valuetext={`${pct}%`}
        onChange={e => setUserVolume(userId, Number(e.target.value))}
        className="w-full accent-fc-accent h-1.5 rounded cursor-pointer" />
    </label>
  )
}

/** Entrée de menu contextuel « Volume de l'utilisateur » (curseur en ligne) ; null pour soi-même. */
export function volumeMenuItem(userId: string, username: string): ContextMenuCustom | null {
  if (userId === useAuth.getState().user?.id) return null
  return { custom: <InlineVolume userId={userId} username={username} /> }
}

export default function UserVolumePopover() {
  const target = useUserVolume(s => s.target)
  const close = useUserVolume(s => s.close)
  const volume = useVoice(s => (target ? s.userVolumes[target.userId] : undefined) ?? 100)
  const setUserVolume = useVoice(s => s.setUserVolume)
  if (!target) return null
  // VolumeSlider s'ouvre à droite de son ancre : on garde le panneau (~210 × 120) dans l'écran.
  const left = Math.max(0, Math.min(target.x, window.innerWidth - 220))
  const top = Math.max(8, Math.min(target.y, window.innerHeight - 130))
  return (
    <div style={{ position: 'fixed', left, top, zIndex: 99999 }}>
      <VolumeSlider
        key={target.userId}
        userId={target.userId}
        username={target.username}
        initialVolume={volume}
        onVolumeChange={v => setUserVolume(target.userId, v)}
        onClose={close}
      />
    </div>
  )
}
