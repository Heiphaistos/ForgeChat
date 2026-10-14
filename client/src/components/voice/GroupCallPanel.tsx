// Interface de l'appel de groupe privé : réutilise la scène (CallStage) et les
// tuiles (PeerTile) des appels vocaux/vidéo, plus la sonnerie globale.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone } from 'lucide-react'
import { useGroupCall } from '../../store/groupCall'
import { useAuth } from '../../store/auth'
import CallStage, { type StageTile, type RenderOpts } from './CallStage'
import { PeerTile } from './CallTiles'
import FullscreenVideo, { type FullscreenSource } from './FullscreenVideo'
import { useT } from '../../i18n'
import { E2ECallBadge } from '../../e2e/E2ECallBadge'
import { openUserVolume } from './UserVolumePopover'
import { openUserMenu } from '../userMenu/store'

interface Member { id: string; username: string; avatar?: string | null }

const hasLiveVideo = (s: MediaStream | null) => !!s?.getVideoTracks().some(t => t.readyState === 'live')

export default function GroupCallPanel({ groupId, members }: { groupId: string; members: Member[] }) {
  const t = useT()
  const me = useAuth(s => s.user)
  const { groupId: callGroup, status, localStream, remotes, micMuted, camOff, activeSpeakerId, active, join, leave, toggleMic, toggleCam, e2ee, e2eeOutdated } = useGroupCall()
  const [featured, setFeatured] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState<FullscreenSource | null>(null)
  const inCall = callGroup === groupId
  const participants = active[groupId] ?? []
  const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members])

  if (!inCall) {
    if (participants.length === 0) return null
    const names = participants.map(id => byId.get(id)?.username ?? '…').join(', ')
    return (
      <div className="flex items-center gap-3 px-4 py-2 bg-fc-green/10 border-b border-fc-green/30 text-sm">
        <Phone size={16} className="text-fc-green flex-shrink-0" aria-hidden />
        <span className="flex-1 min-w-0 truncate text-fc-text">{t('hc.gc.ongoing', { names })}</span>
        <button onClick={() => void join(groupId, 'voice')}
          className="px-3 py-1 rounded bg-fc-green hover:bg-green-600 text-white text-xs font-semibold">{t('hc.gc.join')}</button>
        <button onClick={() => void join(groupId, 'video')} aria-label={t('hc.gc.joinCam')}
          className="p-1.5 rounded bg-fc-hover hover:bg-fc-input text-white"><Video size={14} /></button>
      </div>
    )
  }

  const tiles: StageTile[] = [
    ...(me ? [{ key: `cam-${me.id}`, kind: 'camera' as const, userId: me.id, username: me.username, isLocal: true, stream: localStream }] : []),
    ...Object.entries(remotes).map(([id, stream]) => ({
      key: `cam-${id}`, kind: 'camera' as const, userId: id, username: byId.get(id)?.username ?? '…', isLocal: false, stream,
    })),
  ]
  const render = (t: StageTile, o: RenderOpts) => (
    <PeerTile
      peer={{
        userId: t.userId,
        username: t.username,
        avatar: (t.isLocal ? me?.avatar : byId.get(t.userId)?.avatar) ?? undefined,
        muted: t.isLocal ? micMuted : false,
        videoEnabled: hasLiveVideo(t.stream),
        screenSharing: false,
      }}
      stream={t.stream} muted={t.isLocal} isLocal={t.isLocal} compact={o.compact}
      speaking={!t.isLocal && t.userId === activeSpeakerId}
      onExpand={o.expand && t.stream ? () => setFullscreen({ stream: t.stream, label: t.username }) : undefined}
      onVolume={t.isLocal ? undefined : e => openUserVolume(t.userId, t.username, e)}
      onContextMenu={e => openUserMenu(e, { userId: t.userId, username: t.username, voice: true })}
    />
  )

  return (
    <div className="flex flex-col bg-black/90 border-b border-fc-hover" style={{ height: 'min(55vh, 520px)' }}>
      <div className="flex-1 min-h-0 p-2">
        {status === 'connecting'
          ? <div className="h-full flex items-center justify-center text-fc-muted text-sm animate-pulse">{t('hc.gc.connecting')}</div>
          : <CallStage tiles={tiles} mode="auto" featuredKey={featured} onFeature={setFeatured} render={render} activeSpeakerId={activeSpeakerId} />}
      </div>
      {fullscreen && <FullscreenVideo {...fullscreen} onClose={() => setFullscreen(null)} />}
      <E2ECallBadge encrypted={e2ee} outdatedNames={e2eeOutdated.map(id => byId.get(id)?.username ?? '…')} />
      <div className="flex items-center justify-center gap-3 py-2">
        <button onClick={toggleMic} aria-label={micMuted ? t('hc.gc.micOn') : t('hc.gc.micOff')} aria-pressed={micMuted}
          className={`p-3 rounded-full ${micMuted ? 'bg-fc-red text-white' : 'bg-fc-hover text-white hover:bg-fc-input'}`}>
          {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button onClick={() => void toggleCam()} aria-label={camOff ? t('hc.gc.camOn') : t('hc.gc.camOff')} aria-pressed={!camOff}
          className={`p-3 rounded-full ${camOff ? 'bg-fc-hover text-white hover:bg-fc-input' : 'bg-fc-accent text-white'}`}>
          {camOff ? <VideoOff size={18} /> : <Video size={18} />}
        </button>
        <button onClick={leave} aria-label={t('hc.gc.leave')} className="p-3 rounded-full bg-fc-red hover:bg-red-600 text-white">
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  )
}

/** Sonnerie d'un appel de groupe, affichée où que l'on soit dans l'application. */
export function GroupCallRinger() {
  const t = useT()
  const { ring, dismissRing, join } = useGroupCall()
  const nav = useNavigate()
  useEffect(() => {
    if (!ring) return
    const t = setTimeout(dismissRing, Math.max(0, ring.expiresAt - Date.now()))
    return () => clearTimeout(t)
  }, [ring, dismissRing])
  if (!ring) return null
  const accept = () => {
    nav(`/dms/groups/${ring.groupId}`)
    void join(ring.groupId, ring.callType)
  }
  return (
    <div role="alertdialog" aria-label={t('hc.gc.incoming')}
      className="fixed bottom-4 right-4 z-[400] w-[calc(100%-32px)] max-w-sm bg-fc-sidebar rounded-xl shadow-2xl p-4 flex items-center gap-3 ring-1 ring-fc-green/40">
      <Phone size={20} className="text-fc-green animate-pulse flex-shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold truncate">{t(ring.callType === 'video' ? 'hc.gc.ringVideo' : 'hc.gc.ringVoice', { name: ring.fromUsername })}</p>
        <p className="text-fc-muted text-xs">{t('hc.gc.private')}</p>
      </div>
      <button onClick={accept} className="px-3 py-1.5 rounded bg-fc-green hover:bg-green-600 text-white text-xs font-semibold">{t('hc.gc.join')}</button>
      <button onClick={dismissRing} className="px-3 py-1.5 rounded bg-fc-hover hover:bg-fc-input text-white text-xs">{t('hc.gc.ignore')}</button>
    </div>
  )
}
