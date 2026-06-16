import { useRef, useState, useCallback, useEffect } from 'react'
import { useWs } from '../store/ws'

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

export interface VoicePeer {
  userId: string
  username: string
  avatar?: string
  discriminator?: string
  stream: MediaStream | null
  audioEnabled: boolean
  videoEnabled: boolean
}

interface UseWebRTCReturn {
  joined: boolean
  peers: VoicePeer[]
  localStream: MediaStream | null
  audioEnabled: boolean
  videoEnabled: boolean
  error: string | null
  join: (withVideo?: boolean) => Promise<void>
  leave: () => void
  toggleAudio: () => void
  toggleVideo: () => void
  shareScreen: () => Promise<void>
}

export function useWebRTC(channelId: string | null): UseWebRTCReturn {
  const { on, send } = useWs()

  const [joined, setJoined] = useState(false)
  const [peers, setPeers] = useState<VoicePeer[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const joinedRef = useRef(false)

  const createPC = useCallback(
    (peerId: string, info: { username: string; avatar?: string; discriminator?: string }) => {
      if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId)!

      const pc = new RTCPeerConnection(ICE_CONFIG)
      pcsRef.current.set(peerId, pc)

      // Ajouter les pistes locales au peer
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current!)
        })
      }

      // Envoyer les candidats ICE
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({
            type: 'VOICE_SIGNAL',
            to: peerId,
            payload: { type: 'ice', data: event.candidate.toJSON() },
          })
        }
      }

      // Recevoir le flux distant
      pc.ontrack = (event) => {
        const stream = event.streams[0]
        if (!stream) return
        setPeers(prev =>
          prev.map(p => (p.userId === peerId ? { ...p, stream } : p))
        )
      }

      // Nettoyage si connexion fermée
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setPeers(prev => prev.filter(p => p.userId !== peerId))
          pcsRef.current.delete(peerId)
          pc.close()
        }
      }

      // Ajouter le pair à la liste
      setPeers(prev => {
        if (prev.some(p => p.userId === peerId)) return prev
        return [...prev, {
          userId: peerId, ...info,
          stream: null, audioEnabled: true, videoEnabled: false,
        }]
      })

      return pc
    },
    [send]
  )

  const join = useCallback(async (withVideo = false) => {
    if (joinedRef.current) return
    setError(null)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { width: 1280, height: 720 } : false,
      })
    } catch (err: any) {
      // Retry audio-only if video fails
      if (withVideo) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch {
          setError('Impossible d\'accéder au microphone. Vérifiez les permissions du navigateur.')
          return
        }
      } else {
        setError('Impossible d\'accéder au microphone. Vérifiez les permissions du navigateur.')
        return
      }
    }

    localStreamRef.current = stream
    setLocalStream(stream)
    setVideoEnabled(withVideo && stream.getVideoTracks().length > 0)
    setJoined(true)
    joinedRef.current = true

    send({ type: 'VOICE_JOIN', channel_id: channelId })
  }, [channelId, send])

  const leave = useCallback(() => {
    if (!joinedRef.current) return

    send({ type: 'VOICE_LEAVE', channel_id: channelId })

    pcsRef.current.forEach(pc => pc.close())
    pcsRef.current.clear()

    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
    setPeers([])
    setJoined(false)
    joinedRef.current = false
  }, [channelId, send])

  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return
    const next = !audioEnabled
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = next })
    setAudioEnabled(next)
  }, [audioEnabled])

  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current) return

    if (!videoEnabled) {
      // Activer la caméra
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
        })
        const videoTrack = videoStream.getVideoTracks()[0]
        localStreamRef.current.addTrack(videoTrack)

        // Ajouter la piste à tous les PC existants
        pcsRef.current.forEach(pc => {
          pc.addTrack(videoTrack, localStreamRef.current!)
          const offer = pc.createOffer()
          offer.then(async sdp => {
            await pc.setLocalDescription(sdp)
            // Renegociation
          })
        })

        setVideoEnabled(true)
      } catch {
        setError('Impossible d\'accéder à la caméra.')
      }
    } else {
      // Désactiver la caméra
      localStreamRef.current.getVideoTracks().forEach(t => {
        t.stop()
        localStreamRef.current!.removeTrack(t)
      })
      setVideoEnabled(false)
    }
  }, [videoEnabled])

  const shareScreen = useCallback(async () => {
    try {
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: false,
      })
      const screenTrack = screenStream.getVideoTracks()[0]

      // Remplacer la piste vidéo dans tous les PC
      pcsRef.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) {
          sender.replaceTrack(screenTrack)
        }
      })

      screenTrack.onended = () => {
        setVideoEnabled(false)
      }
    } catch {
      // L'utilisateur a annulé le partage
    }
  }, [])

  // ─── Gestionnaires d'événements WebSocket ───────────────────────────────
  useEffect(() => {
    if (!joined || !channelId) return

    const offExistingPeers = on('VOICE_EXISTING_PEERS', async (d: any) => {
      if (d.channel_id !== channelId) return
      for (const peer of (d.peers ?? [])) {
        const pc = createPC(peer.user_id, {
          username: peer.username,
          avatar: peer.avatar,
          discriminator: peer.discriminator,
        })
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          send({
            type: 'VOICE_SIGNAL',
            to: peer.user_id,
            payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } },
          })
        } catch (e) {
          console.error('Erreur création offer:', e)
        }
      }
    })

    const offUserJoined = on('VOICE_USER_JOINED', (d: any) => {
      if (d.channel_id !== channelId) return
      // Le nouvel arrivant va nous envoyer une offer — on prépare le PC
      createPC(d.user_id, {
        username: d.username,
        avatar: d.avatar,
        discriminator: d.discriminator,
      })
    })

    const offUserLeft = on('VOICE_USER_LEFT', (d: any) => {
      if (d.channel_id !== channelId) return
      const pc = pcsRef.current.get(d.user_id)
      pc?.close()
      pcsRef.current.delete(d.user_id)
      setPeers(prev => prev.filter(p => p.userId !== d.user_id))
    })

    const offSignal = on('VOICE_SIGNAL', async (d: any) => {
      const { from, payload } = d
      const pc = pcsRef.current.get(from)
      if (!pc) return

      try {
        if (payload.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          send({
            type: 'VOICE_SIGNAL',
            to: from,
            payload: { type: 'answer', data: { type: answer.type, sdp: answer.sdp } },
          })
        } else if (payload.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
          }
        } else if (payload.type === 'ice') {
          if (payload.data && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.data))
          }
        }
      } catch (e) {
        console.error('WebRTC signal error:', e)
      }
    })

    return () => {
      offExistingPeers()
      offUserJoined()
      offUserLeft()
      offSignal()
    }
  }, [joined, channelId, createPC, on, send])

  // Nettoyage au démontage du composant
  useEffect(() => {
    return () => {
      if (joinedRef.current) {
        pcsRef.current.forEach(pc => pc.close())
        pcsRef.current.clear()
        localStreamRef.current?.getTracks().forEach(t => t.stop())
        localStreamRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    joined, peers, localStream, audioEnabled, videoEnabled, error,
    join, leave, toggleAudio, toggleVideo, shareScreen,
  }
}
