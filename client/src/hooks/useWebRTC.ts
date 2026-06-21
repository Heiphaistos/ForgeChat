import { useRef, useState, useCallback, useEffect } from 'react'
import { useWs } from '../store/ws'
import api from '../api/client'

const FALLBACK_ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

let cachedIceConfig: RTCConfiguration | null = null

async function fetchIceConfig(): Promise<RTCConfiguration> {
  if (cachedIceConfig) return cachedIceConfig
  try {
    const { data } = await api.get('/voice/ice-config')
    cachedIceConfig = { iceServers: data.ice_servers }
    return cachedIceConfig
  } catch {
    return FALLBACK_ICE_CONFIG
  }
}

export interface VoicePeer {
  userId: string
  username: string
  avatar?: string
  discriminator?: string
  stream: MediaStream | null
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharing: boolean
}

interface UseWebRTCReturn {
  joined: boolean
  peers: VoicePeer[]
  localStream: MediaStream | null
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharing: boolean
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
  const [screenSharing, setScreenSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const joinedRef = useRef(false)
  const channelIdRef = useRef<string | null>(channelId)
  // Buffer ICE candidates until setRemoteDescription completes
  const iceCandidateQueues = useRef<Map<string, RTCIceCandidate[]>>(new Map())
  // Refs for state values used inside WS callbacks (avoid stale closures)
  const audioEnabledRef = useRef(true)
  const videoEnabledRef = useRef(false)
  const screenSharingRef = useRef(false)

  useEffect(() => { channelIdRef.current = channelId }, [channelId])

  const flushIceCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queue = iceCandidateQueues.current.get(peerId) ?? []
    iceCandidateQueues.current.delete(peerId)
    for (const candidate of queue) {
      await pc.addIceCandidate(candidate).catch((e) => {
        console.warn('ICE candidate flush error:', e)
      })
    }
  }, [])

  const createPC = useCallback(
    (peerId: string, info: { username: string; avatar?: string; discriminator?: string }) => {
      if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId)!

      const iceConfig = cachedIceConfig ?? FALLBACK_ICE_CONFIG
      const pc = new RTCPeerConnection(iceConfig)
      pcsRef.current.set(peerId, pc)

      // Add all local tracks immediately
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current!)
        })
      }

      // Relay local ICE candidates to the remote peer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({
            type: 'VOICE_SIGNAL',
            to: peerId,
            payload: { type: 'ice', data: event.candidate.toJSON() },
          })
        }
      }

      // Apply incoming remote tracks to the peer entry
      pc.ontrack = (event) => {
        const stream = event.streams[0]
        if (!stream) return
        setPeers(prev =>
          prev.map(p => (p.userId === peerId ? { ...p, stream } : p))
        )
      }

      // Remove peer on connection failure/disconnect
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setPeers(prev => prev.filter(p => p.userId !== peerId))
          pcsRef.current.delete(peerId)
          iceCandidateQueues.current.delete(peerId)
          pc.close()
        }
      }

      // Add peer to state list
      setPeers(prev => {
        if (prev.some(p => p.userId === peerId)) return prev
        return [...prev, {
          userId: peerId, ...info,
          stream: null, audioEnabled: true, videoEnabled: false, screenSharing: false,
        }]
      })

      return pc
    },
    [send]
  )

  const join = useCallback(async (withVideo = false) => {
    if (joinedRef.current) return
    setError(null)

    // Ensure TURN config is loaded before peer connections are created
    await fetchIceConfig()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { width: 1280, height: 720 } : false,
      })
    } catch {
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
    const hasVideo = withVideo && stream.getVideoTracks().length > 0
    setVideoEnabled(hasVideo)
    videoEnabledRef.current = hasVideo
    setJoined(true)
    joinedRef.current = true

    send({ type: 'VOICE_JOIN', channel_id: channelId })
  }, [channelId, send])

  const leave = useCallback(() => {
    if (!joinedRef.current) return

    send({ type: 'VOICE_LEAVE', channel_id: channelIdRef.current })

    pcsRef.current.forEach(pc => pc.close())
    pcsRef.current.clear()
    iceCandidateQueues.current.clear()

    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    setLocalStream(null)
    setPeers([])
    setJoined(false)
    joinedRef.current = false
    setScreenSharing(false)
    screenSharingRef.current = false
  }, [send])

  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return
    const next = !audioEnabledRef.current
    localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = next })
    setAudioEnabled(next)
    audioEnabledRef.current = next
    // Broadcast mute state so remote peers can update their UI
    send({
      type: 'VOICE_STATE',
      channel_id: channelIdRef.current,
      muted: !next,
      video: videoEnabledRef.current,
      screen: screenSharingRef.current,
    })
  }, [send])

  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current) return

    if (!videoEnabledRef.current) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
        })
        const videoTrack = videoStream.getVideoTracks()[0]
        localStreamRef.current.addTrack(videoTrack)
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))

        // Add track to each existing peer connection and send renegotiation offer
        for (const [peerId, pc] of pcsRef.current) {
          pc.addTrack(videoTrack, localStreamRef.current)
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            send({
              type: 'VOICE_SIGNAL',
              to: peerId,
              payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } },
            })
          } catch (e) {
            console.error('Renegotiation error (toggleVideo on):', e)
          }
        }

        setVideoEnabled(true)
        videoEnabledRef.current = true
        send({
          type: 'VOICE_STATE',
          channel_id: channelIdRef.current,
          muted: !audioEnabledRef.current,
          video: true,
          screen: screenSharingRef.current,
        })
      } catch {
        setError('Impossible d\'accéder à la caméra.')
      }
    } else {
      // Stop camera tracks and null out video senders
      localStreamRef.current.getVideoTracks().forEach(t => {
        t.stop()
        localStreamRef.current!.removeTrack(t)
      })
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      pcsRef.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        sender?.replaceTrack(null)
      })
      setVideoEnabled(false)
      videoEnabledRef.current = false
      setScreenSharing(false)
      screenSharingRef.current = false
      send({
        type: 'VOICE_STATE',
        channel_id: channelIdRef.current,
        muted: !audioEnabledRef.current,
        video: false,
        screen: false,
      })
    }
  }, [send])

  const shareScreen = useCallback(async () => {
    try {
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { cursor: 'always', displaySurface: 'monitor' },
        audio: false,
      })
      const screenTrack = screenStream.getVideoTracks()[0]

      // Replace or add video track in each peer connection
      for (const [peerId, pc] of pcsRef.current) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) {
          // replaceTrack is transparent for same kind — no SDP renegotiation needed
          await sender.replaceTrack(screenTrack)
        } else {
          // No video sender yet — add track and renegotiate
          if (localStreamRef.current) {
            pc.addTrack(screenTrack, localStreamRef.current)
          }
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            send({
              type: 'VOICE_SIGNAL',
              to: peerId,
              payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } },
            })
          } catch {}
        }
      }

      // Update local stream preview
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => {
          t.stop()
          localStreamRef.current!.removeTrack(t)
        })
        localStreamRef.current.addTrack(screenTrack)
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      }
      setVideoEnabled(true)
      videoEnabledRef.current = true
      setScreenSharing(true)
      screenSharingRef.current = true

      send({
        type: 'VOICE_STATE',
        channel_id: channelIdRef.current,
        muted: !audioEnabledRef.current,
        video: true,
        screen: true,
      })

      screenTrack.onended = () => {
        setVideoEnabled(false)
        videoEnabledRef.current = false
        setScreenSharing(false)
        screenSharingRef.current = false
        if (localStreamRef.current) {
          localStreamRef.current.getVideoTracks().forEach(t => {
            t.stop()
            localStreamRef.current!.removeTrack(t)
          })
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
        }
        pcsRef.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          sender?.replaceTrack(null)
        })
        send({
          type: 'VOICE_STATE',
          channel_id: channelIdRef.current,
          muted: !audioEnabledRef.current,
          video: false,
          screen: false,
        })
      }
    } catch {
      // User cancelled screen share picker
    }
  }, [send])

  // ─── WebSocket event handlers ────────────────────────────────────────────────
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
        // Apply initial voice state from server
        setPeers(prev => prev.map(p =>
          p.userId === peer.user_id
            ? { ...p, audioEnabled: !peer.muted, videoEnabled: peer.video ?? false, screenSharing: peer.screen ?? false }
            : p
        ))
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
      // New joiner will send us an offer — prepare the PC so it's ready
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
      iceCandidateQueues.current.delete(d.user_id)
      setPeers(prev => prev.filter(p => p.userId !== d.user_id))
    })

    const offSignal = on('VOICE_SIGNAL', async (d: any) => {
      const { from, payload } = d
      const pc = pcsRef.current.get(from)
      if (!pc) return

      try {
        if (payload.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
          // Drain any ICE candidates that arrived before remoteDescription was ready
          await flushIceCandidates(from, pc)
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
            await flushIceCandidates(from, pc)
          }
        } else if (payload.type === 'ice') {
          if (payload.data) {
            const candidate = new RTCIceCandidate(payload.data)
            if (pc.remoteDescription) {
              await pc.addIceCandidate(candidate)
            } else {
              // Queue the candidate — will be flushed after setRemoteDescription
              const queue = iceCandidateQueues.current.get(from) ?? []
              queue.push(candidate)
              iceCandidateQueues.current.set(from, queue)
            }
          }
        }
      } catch (e) {
        console.error('WebRTC signal error:', e)
      }
    })

    // Update remote peer UI when they toggle mute/video/screen
    const offVoiceStateUpdate = on('VOICE_STATE_UPDATE', (d: any) => {
      if (d.channel_id !== channelId) return
      setPeers(prev => prev.map(p =>
        p.userId === d.user_id
          ? { ...p, audioEnabled: !d.muted, videoEnabled: d.video ?? false, screenSharing: d.screen ?? false }
          : p
      ))
    })

    return () => {
      offExistingPeers()
      offUserJoined()
      offUserLeft()
      offSignal()
      offVoiceStateUpdate()
    }
  }, [joined, channelId, createPC, flushIceCandidates, on, send])

  // Pre-load ICE/TURN config on mount
  useEffect(() => { fetchIceConfig() }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (joinedRef.current) {
        pcsRef.current.forEach(pc => pc.close())
        pcsRef.current.clear()
        iceCandidateQueues.current.clear()
        localStreamRef.current?.getTracks().forEach(t => t.stop())
        localStreamRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    joined, peers, localStream, audioEnabled, videoEnabled, screenSharing, error,
    join, leave, toggleAudio, toggleVideo, shareScreen,
  }
}
