import { Check, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { useVoice } from '../../store/voice'
import { useCallStore } from '../../store/call'
import { setAudioOutput } from '../../lib/voicePlayback'
import { useT } from '../../i18n'

type Kind = 'audioinput' | 'audiooutput'

/** Menus de la petite flèche du micro et du casque : choix du périphérique, lien vers les réglages. */
export function useDeviceMenu() {
  const t = useT()
  const nav = useNavigate()
  const menu = useContextMenu()

  const choose = (kind: Kind, id: string) => {
    if (kind === 'audiooutput') { setAudioOutput(id); return }
    // Même chemin que Réglages > Voix : remplacé à chaud dans le salon et dans l'appel privé.
    void useVoice.getState().setAudioInput(id)
    void useCallStore.getState().setAudioInput()
  }

  const open = async (kind: Kind, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const { clientX: x, clientY: y } = e
    const tail: ContextMenuEntry[] = [
      { separator: true },
      { label: t('dock.dev.settings'), icon: <Settings size={14} />, onClick: () => nav('/settings?section=audio') },
    ]
    const notice = (label: string) => menu.openAt(x, y, [{ label, onClick: () => {}, disabled: true }, ...tail])
    if (kind === 'audiooutput' && !('setSinkId' in HTMLMediaElement.prototype)) return notice(t('dock.dev.noOutput'))
    let devices: MediaDeviceInfo[]
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === kind)
    } catch {
      return notice(t('dock.dev.error'))
    }
    const current = localStorage.getItem(kind === 'audiooutput' ? 'fc_audio_output' : 'fc_audio_input') ?? ''
    const item = (id: string, label: string): ContextMenuEntry => ({
      label, icon: id === current ? <Check size={14} /> : undefined, onClick: () => choose(kind, id),
    })
    // « default » / « communications » (Chrome) doublonnent l'entrée « Par défaut ».
    const real = devices.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    menu.openAt(x, y, [
      item('', t('dock.dev.default')),
      ...real.map((d, i) => item(d.deviceId, d.label || t(kind === 'audioinput' ? 'dock.dev.mic' : 'dock.dev.speaker', { n: i + 1 }))),
      ...tail,
    ])
  }

  return {
    openInput: (e: React.MouseEvent) => void open('audioinput', e),
    openOutput: (e: React.MouseEvent) => void open('audiooutput', e),
    node: menu.node,
  }
}
