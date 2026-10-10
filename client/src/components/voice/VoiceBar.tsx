import { useCallback, useEffect, useState } from 'react'
import { Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, PhoneOff, Phone, LifeBuoy, Music2, Tv } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery, skipToken } from '@tanstack/react-query'
import api from '../../api/client'
import { useVoice } from '../../store/voice'
import { useCallStore } from '../../store/call'
import { useGroupCall } from '../../store/groupCall'
import { useWakeLock } from '../../hooks/useWakeLock'
import { useT } from '../../i18n'
import { useContextMenu } from '../ui/ContextMenu'
import { useRemoteSupportItem } from '../chat/RemoteSupport'
import { formatDuration } from '../../lib/voiceDock'
import CallQualityIndicator from './CallQualityIndicator'
import DockPopover from './DockPopover'
import Soundboard from './Soundboard'
import StreamCard from './StreamCard'

/** Conversations privées en cache (liste chargée par la barre latérale) : nom du correspondant ou du groupe. */
interface DmLite { id: string; name?: string | null; username?: string | null }
function useDmName(id: string | null, fallback: string) {
  // skipToken : lit le cache sans jamais lancer la requête (la barre latérale la charge et la transforme).
  const { data } = useQuery<DmLite[]>({ queryKey: ['dms'], queryFn: skipToken })
  const dm = data?.find(d => d.id === id)
  return dm?.name || dm?.username || fallback
}

function useElapsed(since: number | null) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (since === null) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [since])
  return since === null ? null : formatDuration((now - since) / 1000)
}

/**
 * Panneau « Vocal connecté » du bas à gauche : salon de serveur, appel privé ou appel de groupe,
 * visible sur toutes les pages. `compact` : page Actualités sur PC, colonne d'icônes à la
 * largeur du rail des serveurs.
 */
export default function VoiceBar({ compact = false }: { compact?: boolean }) {
  const joined = useVoice(s => s.joined)
  const dmState = useCallStore(s => s.callState)
  const groupStatus = useGroupCall(s => s.status)
  // Garder l'écran allumé pendant l'appel (mobile) — libéré au leave
  useWakeLock(joined)
  if (!joined && dmState === 'idle' && groupStatus === 'idle') return null
  return (
    <div className="bg-fc-sidebar border-t border-black/40 flex-shrink-0 relative">
      {joined && <ServerVoice compact={compact} />}
      {dmState !== 'idle' && <DmCall compact={compact} />}
      {groupStatus !== 'idle' && <GroupCall compact={compact} />}
    </div>
  )
}

function ServerVoice({ compact }: { compact: boolean }) {
  const nav = useNavigate()
  const t = useT()
  const channelId = useVoice(s => s.channelId)
  const channelName = useVoice(s => s.channelName)
  const serverId = useVoice(s => s.serverId)
  const videoEnabled = useVoice(s => s.videoEnabled)
  const screenSharing = useVoice(s => s.screenSharing)
  const { toggleVideo, shareScreen, stopScreenShare, leave } = useVoice.getState()
  const [since] = useState(Date.now)
  const [soundboard, setSoundboard] = useState(false)
  const closeSoundboard = useCallback(() => setSoundboard(false), [])

  const { data: servers } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
    staleTime: 30_000,
  })
  const serverName = servers?.find(s => s.id === serverId)?.name

  // Support à distance avec un participant du salon (menu de ses membres).
  const roomParticipants = useVoice(s => s.roomParticipants)
  const remoteSupportItem = useRemoteSupportItem()
  const supportMenu = useContextMenu()
  const openSupportMenu = (e: React.MouseEvent) => {
    const items = (channelId ? roomParticipants[channelId] ?? [] : [])
      .map(p => remoteSupportItem(p.userId, t('rs.with', { name: p.username })))
      .filter(i => i !== null)
    supportMenu.open(e, items.length ? items : [{ label: t('rs.nobody'), onClick: () => {}, disabled: true }])
  }

  const channelPath = serverId && channelId ? `/servers/${serverId}/channels/${channelId}` : null
  const openChannel = channelPath ? () => nav(channelPath) : undefined
  const stopShare = () => void stopScreenShare()

  return (
    <>
      <div className={compact ? 'md:hidden' : ''}>
        {screenSharing && <StreamCard />}
        <ConnectedRow
          title={t('voice.connected')}
          since={since}
          place={[channelName ?? t('voice.backToChannel'), serverName].filter(Boolean).join(' / ')}
          onOpen={openChannel}
          indicator={<CallQualityIndicator iconOnly />}
          onHangup={leave}
        />
        <div className="flex items-center px-1 pb-1.5 gap-0.5">
          <BarBtn pressed={videoEnabled} onClick={() => void toggleVideo()} title={videoEnabled ? t('voice.cameraOff') : t('voice.cameraOn')}>
            {videoEnabled ? <Video size={14} /> : <VideoOff size={14} />}
          </BarBtn>
          <BarBtn pressed={screenSharing} accent={screenSharing} onClick={screenSharing ? stopShare : () => void shareScreen()} title={screenSharing ? t('voice.stopShare') : t('voice.shareScreen')}>
            {screenSharing ? <Monitor size={14} /> : <MonitorOff size={14} />}
          </BarBtn>
          {channelPath && (
            <BarBtn onClick={() => nav(channelPath, { state: { openActivity: true } })} title={t('dock.activities')}>
              <Tv size={14} />
            </BarBtn>
          )}
          {serverId && channelId && (
            <BarBtn pressed={soundboard} onClick={() => setSoundboard(v => !v)} title={t('voice.soundboard')} keepPopover>
              <Music2 size={14} />
            </BarBtn>
          )}
          <BarBtn onClick={openSupportMenu} title={t('rs.button')}>
            <LifeBuoy size={14} />
          </BarBtn>
        </div>
        {soundboard && serverId && channelId && (
          <DockPopover onClose={closeSoundboard} label={t('voice.soundboard')}>
            <Soundboard serverId={serverId} channelId={channelId} onClose={closeSoundboard} />
          </DockPopover>
        )}
        {supportMenu.node}
      </div>
      {compact && (
        <CompactColumn
          label={[t('voice.connected'), channelName].filter(Boolean).join(' — ')}
          onOpen={openChannel}
          indicator={<CallQualityIndicator iconOnly />}
          onHangup={leave}
        >
          {screenSharing && (
            <button onClick={stopShare} title={t('dock.stream.stop')} aria-label={t('dock.stream.stop')} className="p-1.5 rounded text-fc-green hover:bg-red-500/20 hover:text-red-400 transition">
              <MonitorOff size={14} />
            </button>
          )}
        </CompactColumn>
      )}
    </>
  )
}

function DmCall({ compact }: { compact: boolean }) {
  const nav = useNavigate()
  const t = useT()
  const dmId = useCallStore(s => s.dmId)
  const callState = useCallStore(s => s.callState)
  const connectedAt = useCallStore(s => s.connectedAt)
  const micMuted = useCallStore(s => s.micMuted)
  const camOff = useCallStore(s => s.camOff)
  const { toggleMic, toggleCam, hangup } = useCallStore.getState()
  const name = useDmName(dmId, t('dock.call.dm'))
  return (
    <CallSection
      compact={compact}
      title={t(callState === 'connected' ? 'voice.connected' : callState === 'calling' ? 'dock.call.ringing' : 'voice.q.connecting')}
      since={callState === 'connected' ? connectedAt : null}
      place={name} onOpen={dmId ? () => nav(`/dms/${dmId}`) : undefined} onHangup={hangup}
      micMuted={micMuted} onToggleMic={toggleMic} camOff={camOff} onToggleCam={() => void toggleCam()}
    />
  )
}

function GroupCall({ compact }: { compact: boolean }) {
  const nav = useNavigate()
  const t = useT()
  const groupId = useGroupCall(s => s.groupId)
  const status = useGroupCall(s => s.status)
  const micMuted = useGroupCall(s => s.micMuted)
  const camOff = useGroupCall(s => s.camOff)
  const { toggleMic, toggleCam, leave } = useGroupCall.getState()
  const [since] = useState(Date.now)
  const name = useDmName(groupId, t('dock.call.group'))
  return (
    <CallSection
      compact={compact}
      title={status === 'connected' ? t('voice.connected') : t('voice.q.connecting')}
      since={status === 'connected' ? since : null}
      place={name} onOpen={groupId ? () => nav(`/dms/groups/${groupId}`) : undefined} onHangup={leave}
      micMuted={micMuted} onToggleMic={toggleMic} camOff={camOff} onToggleCam={() => void toggleCam()}
    />
  )
}

/** Appel privé ou de groupe : leur micro et leur caméra sont propres à l'appel. */
function CallSection({ compact, title, since, place, onOpen, onHangup, micMuted, onToggleMic, camOff, onToggleCam }: {
  compact: boolean; title: string; since: number | null; place: string; onOpen?: () => void; onHangup: () => void
  micMuted: boolean; onToggleMic: () => void; camOff: boolean; onToggleCam: () => void
}) {
  const t = useT()
  return (
    <>
      <div className={compact ? 'md:hidden' : ''}>
        <ConnectedRow title={title} since={since} place={place} onOpen={onOpen} onHangup={onHangup} />
        <div className="flex items-center px-1 pb-1.5 gap-0.5">
          <BarBtn pressed={!micMuted} danger={micMuted} onClick={onToggleMic} title={micMuted ? t('voice.micUnmute') : t('voice.micMute')}>
            {micMuted ? <MicOff size={14} /> : <Mic size={14} />}
          </BarBtn>
          <BarBtn pressed={!camOff} onClick={onToggleCam} title={camOff ? t('voice.cameraOn') : t('voice.cameraOff')}>
            {camOff ? <VideoOff size={14} /> : <Video size={14} />}
          </BarBtn>
        </div>
      </div>
      {compact && <CompactColumn label={`${title} — ${place}`} onOpen={onOpen} onHangup={onHangup} />}
    </>
  )
}

function ConnectedRow({ title, since, place, onOpen, indicator, onHangup }: {
  title: string; since: number | null; place: string; onOpen?: () => void; indicator?: React.ReactNode; onHangup: () => void
}) {
  const t = useT()
  const elapsed = useElapsed(since)
  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1">
      {indicator ?? <Phone size={12} className="text-fc-green flex-shrink-0" aria-hidden />}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-green-400 leading-tight truncate">
          {title}
          {elapsed && <span className="text-fc-muted font-normal ml-1.5 tabular-nums" aria-label={t('voice.callDuration', { d: elapsed })}>{elapsed}</span>}
        </div>
        <button onClick={onOpen} disabled={!onOpen} title={t('dock.open')}
          className="text-[11px] text-fc-muted enabled:hover:text-white enabled:hover:underline transition truncate block max-w-full text-left">
          {place}
        </button>
      </div>
      <button onClick={onHangup} title={t('dock.hangup')} aria-label={t('dock.hangup')}
        className="p-2 md:p-1 rounded hover:bg-red-500/20 text-fc-muted hover:text-red-400 transition flex-shrink-0 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center">
        <PhoneOff size={14} />
      </button>
    </div>
  )
}

/** Version PC de la page Actualités (72 px) : aller à l'appel, actions éventuelles, raccrocher. */
function CompactColumn({ label, onOpen, indicator, onHangup, children }: {
  label: string; onOpen?: () => void; indicator?: React.ReactNode; onHangup: () => void; children?: React.ReactNode
}) {
  const t = useT()
  return (
    <div className="hidden md:flex flex-col items-center gap-1 py-2">
      <button onClick={onOpen} title={label} aria-label={label} className="p-1.5 rounded hover:bg-fc-hover transition">
        {indicator ?? <Phone size={14} className="text-fc-green" aria-hidden />}
      </button>
      {children}
      <button onClick={onHangup} title={t('dock.hangup')} aria-label={t('dock.hangup')} className="p-1.5 rounded text-fc-muted hover:bg-red-500/20 hover:text-red-400 transition">
        <PhoneOff size={14} />
      </button>
    </div>
  )
}

function BarBtn({ pressed, danger = false, accent = false, keepPopover = false, onClick, title, children }: {
  /** Bouton à bascule (caméra, partage…) ; absent pour une simple action. */
  pressed?: boolean
  danger?: boolean
  accent?: boolean
  /** Ouvre une fenêtre posée : son clic ne doit pas compter comme un clic extérieur qui la referme. */
  keepPopover?: boolean
  onClick: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
}) {
  const base = 'flex-1 flex items-center justify-center p-2.5 md:p-1.5 min-h-[44px] md:min-h-0 rounded transition'
  const cls = danger ? 'text-red-400 hover:bg-red-500/20'
    : accent ? 'text-green-400 hover:bg-green-500/20'
    : pressed === false ? 'text-fc-muted/50 hover:bg-fc-hover hover:text-white'
    : 'text-fc-muted hover:bg-fc-hover hover:text-white'
  return (
    <button className={`${base} ${cls}`} onClick={onClick} title={title} aria-label={title} aria-pressed={pressed}
      onMouseDown={keepPopover ? e => e.stopPropagation() : undefined}>
      {children}
    </button>
  )
}
