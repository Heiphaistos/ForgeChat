import { Sheet, type SheetAction } from '@/components/Sheet'
import { useT } from '@/i18n'
import { usePeerVolumes, VOLUME_STEPS } from '@/stores/peerVolumes'

/** Volume d'une personne par paliers de 25 % (0 à 200 %), mémorisé et appliqué partout (salon, MP, groupe). */
export function PeerVolumeSheet({
  peer,
  onClose,
  extra = [],
}: {
  peer: { userId: string; name: string } | null
  onClose: () => void
  /** Actions ajoutées sous les paliers (ex. support à distance). */
  extra?: SheetAction[]
}) {
  const t = useT()
  const current = usePeerVolumes((s) => (peer ? (s.volumes[peer.userId] ?? 1) : 1))
  const setVolume = usePeerVolumes((s) => s.setVolume)
  const actions: SheetAction[] = peer
    ? [
        ...VOLUME_STEPS.map(
          (v): SheetAction => ({
            label: v === 0 ? t('voice.mute') : t('voice.volPct', { n: Math.round(v * 100) }),
            icon: v === 0 ? 'volume-mute' : v < 1 ? 'volume-low' : 'volume-high',
            selected: current === v,
            onPress: () => setVolume(peer.userId, v),
          }),
        ),
        ...extra,
      ]
    : []
  return <Sheet visible={!!peer} onClose={onClose} title={peer ? t('voice.volumeOf', { name: peer.name }) : undefined} actions={actions} />
}
