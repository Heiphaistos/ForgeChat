import { useCallback, useEffect, useRef, useState } from 'react'
import { useWs } from '../store/ws'

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export function useDmCall(dmId: string | undefined, partnerId: string | undefined) {
  const { on, send } = useWs()
  const [callState, setCallState] = useState<CallState>('idle')
  const [callType, setCallType] = useState<'voice' | 'video'>('voice')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [micMuted, setMicMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])

  const cleanup = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    setLocalStream(prev => {
      prev?.getTracks().forEach(t => t.stop())
      return null
    })
    setRemoteStream(null)
    setCallState('idle')
    setMicMuted(false)
    setCamOff(false)
    pendingCandidates.current = []
  }, [])

  const buildPc = useCallback((pid: string) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.onicecandidate = e => {
      if (e.candidate) {
        send({ type: 'VOICE_SIGNAL', to: pid, payload: { type: 'ice', candidate: e.candidate } })
      }
    }
    pc.ontrack = e => {
      if (e.streams[0]) setRemoteStream(e.streams[0])
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setCallState('connected')
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) cleanup()
    }
    pcRef.current = pc
    return pc
  }, [send, cleanup])

  // Initiate outgoing call
  const startCall = useCallback(async (type: 'voice' | 'video') => {
    if (!partnerId || !dmId) return
    setCallType(type)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' })
      setLocalStream(stream)
      const pc = buildPc(partnerId)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      send({ type: 'DM_CALL_INIT', to: partnerId, dm_id: dmId, call_type: type })
      setCallState('calling')
    } catch {
      cleanup()
      throw new Error('Accès micro/caméra refusé')
    }
  }, [partnerId, dmId, buildPc, send, cleanup])

  // Accept incoming call (partner accepts, they are the callee)
  const acceptCall = useCallback(async (fromUserId: string, type: 'voice' | 'video') => {
    setCallType(type)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' })
      setLocalStream(stream)
      const pc = buildPc(fromUserId)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      if (dmId) send({ type: 'DM_CALL_ACCEPT', to: fromUserId, dm_id: dmId })
      setCallState('ringing')
    } catch {
      cleanup()
    }
  }, [dmId, buildPc, send, cleanup])

  const declineCall = useCallback((fromUserId: string) => {
    if (dmId) send({ type: 'DM_CALL_DECLINE', to: fromUserId, dm_id: dmId })
  }, [dmId, send])

  const hangup = useCallback(() => {
    if (partnerId && dmId) send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
    cleanup()
  }, [partnerId, dmId, send, cleanup])

  const toggleMic = useCallback(() => {
    if (!localStream) return
    const audioTrack = localStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      setMicMuted(!audioTrack.enabled)
    }
  }, [localStream])

  const toggleCam = useCallback(() => {
    if (!localStream) return
    const videoTrack = localStream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      setCamOff(!videoTrack.enabled)
    }
  }, [localStream])

  // WS signal listeners
  useEffect(() => {
    const offSignal = on('VOICE_SIGNAL', async (d: any) => {
      const pc = pcRef.current
      if (!pc) return
      const payload = d.payload
      if (!payload?.type) return

      try {
        if (payload.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          for (const c of pendingCandidates.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
          }
          pendingCandidates.current = []
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          const pid = d.from ? String(d.from) : partnerId
          if (pid) send({ type: 'VOICE_SIGNAL', to: pid, payload: { type: 'answer', sdp: answer } })
        } else if (payload.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          }
        } else if (payload.type === 'ice') {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {})
          } else {
            pendingCandidates.current.push(payload.candidate)
          }
        }
      } catch {
        // Silently ignore stale signal errors
      }
    })

    // Caller receives this when callee accepts → create WebRTC offer
    const offAccepted = on('DM_CALL_ACCEPTED', async (d: any) => {
      if (d.dm_id !== dmId) return
      const pc = pcRef.current
      if (!pc) return
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        if (partnerId) {
          send({ type: 'VOICE_SIGNAL', to: partnerId, payload: { type: 'offer', sdp: offer } })
        }
        setCallState('ringing')
      } catch {
        cleanup()
      }
    })

    const offEnded = on('DM_CALL_ENDED', (d: any) => {
      if (d.dm_id !== dmId) return
      cleanup()
    })

    const offDeclined = on('DM_CALL_DECLINED', (d: any) => {
      if (d.dm_id !== dmId) return
      cleanup()
    })

    return () => { offSignal(); offAccepted(); offEnded(); offDeclined() }
  }, [dmId, partnerId, on, send, cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pcRef.current?.close()
      pcRef.current = null
    }
  }, [])

  return {
    callState, callType, localStream, remoteStream, micMuted, camOff,
    startCall, acceptCall, declineCall, hangup, toggleMic, toggleCam,
  }
}
