import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { useVoice, type VoicePeer } from '../../store/voice'

export const recordingName = (blob: Blob) =>
  `enregistrement-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'}`

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Flux à mixer : chaque participant qui n'a pas refusé l'enregistrement (micro + son de son partage). */
export function recordableStreams(me: { stream: MediaStream | null; noRecord: boolean }, peers: VoicePeer[]): Map<string, MediaStream> {
  const out = new Map<string, MediaStream>()
  const add = (owner: string, st: MediaStream | null | undefined) => {
    if (st && st.getAudioTracks().length > 0) out.set(`${owner}:${st.id}`, st)
  }
  if (!me.noRecord) add('me', me.stream)
  for (const p of peers) {
    if (p.noRecord) continue
    add(p.userId, p.stream)
    add(p.userId, p.screenStream)
  }
  return out
}

/**
 * Enregistrement du salon vocal, sur l'appareil : mixage des voix (sauf celles des
 * participants qui ont refusé, retirées dès leur refus, et ajout des arrivants), puis
 * fichier remis à l'appelant (envoi chiffré dans un salon ou téléchargement). Le salon
 * est prévenu par le drapeau `recording` de VOICE_STATE.
 */
export function useVoiceRecording() {
  const t = useT()
  const localStream = useVoice(s => s.localStream)
  const peers = useVoice(s => s.peers)
  const noRecord = useVoice(s => s.noRecord)
  const recording = useVoice(s => s.recording)
  const setRecording = useVoice(s => s.setRecording)
  const [result, setResult] = useState<Blob | null>(null)
  const ctxRef = useRef<{ ctx: AudioContext; dest: MediaStreamAudioDestinationNode; nodes: Map<string, MediaStreamAudioSourceNode> } | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const alive = useRef(true)

  const sync = useCallback(() => {
    const mix = ctxRef.current
    if (!mix) return
    const wanted = recordableStreams({ stream: localStream, noRecord }, peers)
    for (const [key, node] of mix.nodes) {
      if (!wanted.has(key)) { node.disconnect(); mix.nodes.delete(key) }
    }
    for (const [key, st] of wanted) {
      if (mix.nodes.has(key)) continue
      const node = mix.ctx.createMediaStreamSource(new MediaStream(st.getAudioTracks()))
      node.connect(mix.dest)
      mix.nodes.set(key, node)
    }
  }, [localStream, noRecord, peers])

  useEffect(sync, [sync])

  const start = useCallback(() => {
    if (!recordableStreams({ stream: localStream, noRecord }, peers).size) { toast.error(t('voice.nothingToRecord')); return }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
    try {
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      ctxRef.current = { ctx, dest, nodes: new Map() }
      sync()
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = chunks.length ? new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }) : null
        if (blob && alive.current) setResult(blob)
        else if (blob) downloadBlob(blob, recordingName(blob))
        void ctx.close()
        if (ctxRef.current?.ctx === ctx) ctxRef.current = null
      }
      recorder.start(1000)
      recRef.current = recorder
      setRecording(true)
      toast.success(t('voice.recordingStarted'))
    } catch {
      toast.error(t('voice.recordingFailed'))
    }
  }, [localStream, noRecord, peers, setRecording, sync, t])

  const stop = useCallback(() => {
    recRef.current?.stop()
    recRef.current = null
    setRecording(false)
  }, [setRecording])

  // Page quittée pendant l'enregistrement : rien n'est perdu, le fichier est téléchargé sur l'appareil.
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; recRef.current?.stop(); useVoice.getState().setRecording(false) }
  }, [])

  return { recording, start, stop, result, clearResult: () => setResult(null) }
}
