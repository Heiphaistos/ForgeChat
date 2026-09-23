// Tuiles d'appel : caméra (ou avatar) d'un participant, et écran partagé.
// Elles remplissent leur conteneur ; la taille est décidée par CallStage.
import { mediaUrl } from '../../api/client'
import { MicOff, Monitor, Volume2, Maximize2, ExternalLink, Eye, EyeOff } from 'lucide-react'
import NativeVideo from './NativeVideo'

// ─── Peer Tile ─────────────────────────────────────────────────────────────────
export function PeerTile({
  peer, stream, muted = false, isLocal = false, speaking = false,
  handRaised = false, blurEnabled = false, onExpand, onVolume, onPopOut, connectionLost = false, compact = false,
  videoUrl = null,
}: {
  peer: { username: string; avatar?: string; muted: boolean; videoEnabled: boolean; screenSharing: boolean }
  stream: MediaStream | null; muted?: boolean; isLocal?: boolean; speaking?: boolean
  handRaised?: boolean; blurEnabled?: boolean; onExpand?: () => void; onVolume?: () => void
  onPopOut?: () => void; connectionLost?: boolean
  /** Vignette de bandeau : avatar et textes réduits. */
  compact?: boolean
  /** Application Linux : flux vidéo local (WebSocket) à la place d'un MediaStream. */
  videoUrl?: string | null
}) {
  const hasStream = !!stream && stream.getVideoTracks().some(t => t.readyState === 'live')
  const hasVideo = peer.videoEnabled && (hasStream || !!videoUrl)

  // Ref callback plutôt qu'useEffect([stream]) : quand la vidéo arrive en cours d'appel
  // (caméra/partage d'écran), la référence du stream ne change pas — un effet ne se
  // rejouerait pas au montage tardif du <video> et le flux ne serait jamais attaché.
  const attachStream = (el: HTMLVideoElement | null) => {
    if (el && stream && el.srcObject !== stream) el.srcObject = stream
  }

  // L'audio des pairs distants ne passe pas par ce <video> (toujours muted pour eux,
  // affichage uniquement) : il est joué par des <audio> natifs dédiés dans
  // PersistentVoiceAudio.tsx, montés indépendamment de cette page — sinon le son
  // coupait dès qu'on quittait le canal (Paramètres, autre salon...) même si l'appel
  // restait connecté.
  return (
    // Remplit son conteneur : c'est la disposition qui fixe la taille. L'ancien
    // aspect-video forçait une hauteur plus grande que la ligne de grille, et la
    // tuile suivante recouvrait le bas (nom et contrôles) de la précédente.
    <div className={`relative w-full h-full min-h-0 rounded-xl overflow-hidden bg-gray-900 flex flex-col items-center justify-center transition-all
      ${speaking ? 'ring-2 ring-fc-green shadow-[0_0_16px_rgba(74,222,128,0.25)]' : 'ring-1 ring-white/5'}
      ${isLocal ? 'ring-fc-accent/50' : ''}`}>
      {hasVideo && !hasStream && videoUrl ? (
        <NativeVideo url={videoUrl} fit="cover" className="w-full h-full"
          style={blurEnabled && isLocal ? { filter: 'blur(8px)' } : undefined} />
      ) : hasVideo ? (
        <video ref={attachStream} autoPlay playsInline
          muted={isLocal ? muted : true}
          className="w-full h-full object-cover"
          style={blurEnabled && isLocal ? { filter: 'blur(8px)' } : undefined} />
      ) : (
        <div className="flex flex-col items-center gap-2">
          {peer.avatar
            ? <img src={mediaUrl(peer.avatar)} alt="" loading="lazy" decoding="async" className={`${compact ? 'w-8 h-8' : 'w-16 h-16'} rounded-full object-cover border-2 border-fc-accent/50`} />
            : <div className={`${compact ? 'w-8 h-8 text-sm' : 'w-16 h-16 text-2xl'} rounded-full bg-fc-accent flex items-center justify-center font-bold text-white`}>
                {peer.username.charAt(0).toUpperCase()}
              </div>}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-1">
          {peer.muted ? <MicOff size={11} className="text-fc-red" /> : null}
          {peer.screenSharing ? <Monitor size={11} className="text-fc-green" /> : null}
          <span className={`${compact ? 'text-[10px] max-w-[80px]' : 'text-xs max-w-[160px]'} text-white truncate`}>{isLocal ? `${peer.username} (Vous)` : peer.username}</span>
        </div>
        <div className="flex items-center gap-1">
          {onVolume && (
            <button onClick={onVolume} aria-label={`Régler le volume de ${peer.username}`} title="Volume" className="p-1.5 rounded hover:bg-white/20 text-white/60 hover:text-white min-w-[28px] min-h-[28px] flex items-center justify-center">
              <Volume2 size={11} aria-hidden />
            </button>
          )}
          {onPopOut && hasVideo && (
            <button onClick={onPopOut} aria-label={`Ouvrir la vidéo de ${peer.username} dans une fenêtre`} title="Détacher dans une fenêtre" className="p-1.5 rounded hover:bg-white/20 text-white/60 hover:text-white min-w-[28px] min-h-[28px] flex items-center justify-center">
              <ExternalLink size={11} aria-hidden />
            </button>
          )}
          {onExpand && hasVideo && (
            <button onClick={onExpand} aria-label="Agrandir la vidéo" className="p-1.5 rounded hover:bg-white/20 text-white/60 hover:text-white min-w-[28px] min-h-[28px] flex items-center justify-center">
              <Maximize2 size={11} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {isLocal && <div className="absolute top-2 left-2 bg-fc-accent/90 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">Vous</div>}
      {connectionLost && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-fc-yellow/90 text-black text-[10px] px-2 py-0.5 rounded-full font-semibold">
          Reconnexion...
        </div>
      )}
      {handRaised && (
        <div className="absolute top-2 right-2 bg-fc-yellow/90 text-white text-xs px-1.5 py-0.5 rounded-full animate-bounce">✋</div>
      )}
    </div>
  )
}

// ─── Screen Tile — flux écran partagé, distinct de la tuile caméra du même peer ──
export function ScreenTile({ stream, url = null, label, onExpand, onVolume, onPopOut, onWatch, onStopWatching, compact = false }: {
  stream: MediaStream | null; url?: string | null; label: string; onExpand?: () => void; onVolume?: () => void; onPopOut?: () => void
  /** Stream non regardé : afficher le bouton « Regarder ». */
  onWatch?: () => void
  onStopWatching?: () => void
  compact?: boolean
}) {
  if (!stream && !url && onWatch) {
    return (
      <div className="relative w-full h-full min-h-0 rounded-xl overflow-hidden bg-gradient-to-br from-gray-900 to-black flex flex-col items-center justify-center gap-2 ring-1 ring-fc-red/40">
        <span className="px-2 py-0.5 rounded bg-fc-red text-white text-[10px] font-bold tracking-wide">LIVE</span>
        <span className={`${compact ? 'text-[10px]' : 'text-sm'} text-white/80 truncate max-w-[90%]`}>Écran de {label}</span>
        <button onClick={e => { e.stopPropagation(); onWatch() }}
          className={`flex items-center gap-1.5 rounded-lg bg-fc-accent hover:bg-fc-accent/80 text-white font-medium ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-sm'}`}>
          <Eye size={compact ? 11 : 14} aria-hidden /> Regarder
        </button>
      </div>
    )
  }
  const attachStream = (el: HTMLVideoElement | null) => {
    if (el && stream && el.srcObject !== stream) el.srcObject = stream
  }
  return (
    <div className="relative w-full h-full min-h-0 rounded-xl overflow-hidden bg-black flex items-center justify-center ring-1 ring-fc-green/40">
      {/* muted : le son du partage est joué par PersistentVoiceAudio, avec son
          propre réglage de volume, distinct de celui de la voix du pair. */}
      {stream
        ? <video ref={attachStream} autoPlay playsInline muted className="w-full h-full object-contain" />
        : url && <NativeVideo url={url} fit="contain" className="w-full h-full" />}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-1">
          <Monitor size={11} className="text-fc-green" />
          <span className={`${compact ? 'text-[10px] max-w-[90px]' : 'text-xs max-w-[220px]'} text-white truncate`}>Écran de {label}</span>
        </div>
        <div className="flex items-center gap-1">
          {onVolume && (
            <button onClick={onVolume} aria-label={`Volume du partage de ${label}`} title="Volume du partage" className="p-1.5 rounded hover:bg-white/20 text-white/60 hover:text-white min-w-[28px] min-h-[28px] flex items-center justify-center">
              <Volume2 size={11} aria-hidden />
            </button>
          )}
          {onStopWatching && (
            <button onClick={onStopWatching} aria-label={`Arrêter de regarder l'écran de ${label}`} title="Arrêter de regarder" className="p-1.5 rounded hover:bg-white/20 text-white/60 hover:text-white min-w-[28px] min-h-[28px] flex items-center justify-center">
              <EyeOff size={11} aria-hidden />
            </button>
          )}
          {onPopOut && (
            <button onClick={onPopOut} aria-label={`Ouvrir l'écran de ${label} dans une fenêtre`} title="Détacher dans une fenêtre" className="p-1.5 rounded hover:bg-white/20 text-white/60 hover:text-white min-w-[28px] min-h-[28px] flex items-center justify-center">
              <ExternalLink size={11} aria-hidden />
            </button>
          )}
          {onExpand && (
            <button onClick={onExpand} aria-label="Agrandir l'écran partagé" className="p-1.5 rounded hover:bg-white/20 text-white/60 hover:text-white min-w-[28px] min-h-[28px] flex items-center justify-center">
              <Maximize2 size={11} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

