// Banc de test LOCAL du chiffrement des médias (piloté par scripts/e2ee-media.playwright.mjs) :
// une page publie un son de 440 Hz chiffré avec la clé de média d'une époque ; une autre
// page l'écoute avec la même clé (son audible) ou une mauvaise clé (rien de décodable).
// Même fournisseur de clé et même dérivation que l'appli (src/e2e/media.ts, src/e2e/crypto.ts).
import { Room, RoomEvent, Track } from 'livekit-client'
import { MediaKeyProvider } from '../src/e2e/mediaKeyProvider'
import * as c from '../src/e2e/crypto'

interface RunOpts { url: string; token: string; convKey: string; conv: string; epoch: number; publish: boolean }

let room: Room | null = null
let decryptErrors = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function run(o: RunOpts) {
  const keyProvider = new MediaKeyProvider()
  await keyProvider.setMediaKey(await c.mediaKey(c.b64uDecode(o.convKey), o.conv, o.epoch), c.mediaKeyIndex(o.epoch))
  const worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' })
  room = new Room({ encryption: { keyProvider, worker } })
  room.on(RoomEvent.EncryptionError, () => { decryptErrors++ })
  await room.setE2EEEnabled(true)
  await room.connect(o.url, o.token, { autoSubscribe: true })
  if (o.publish) {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = 440
    const dest = ctx.createMediaStreamDestination()
    osc.connect(dest)
    osc.start()
    await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0], { source: Track.Source.Microphone, dtx: false })
  }
  return { e2ee: room.isE2EEEnabled }
}

/** Niveau (dB) autour de 440 Hz et moyenne du spectre du son reçu. */
async function measure() {
  if (!room) return { error: 'pas de salle' }
  const pub = [...room.remoteParticipants.values()].flatMap(p => [...p.audioTrackPublications.values()]).find(p => p.track)
  const track = pub?.track?.mediaStreamTrack
  if (!track) return { error: 'aucune piste reçue' }
  // Chrome ne livre le son WebRTC distant à WebAudio que si un élément le lit aussi.
  const el = new Audio()
  el.srcObject = new MediaStream([track])
  el.muted = true
  await el.play().catch(() => {})
  const ctx = new AudioContext()
  const an = ctx.createAnalyser()
  an.fftSize = 2048
  ctx.createMediaStreamSource(new MediaStream([track])).connect(an)
  await sleep(2000)
  const buf = new Float32Array(an.frequencyBinCount)
  an.getFloatFrequencyData(buf)
  const bin = Math.round(440 / (ctx.sampleRate / an.fftSize))
  const peak = Math.max(buf[bin - 1], buf[bin], buf[bin + 1])
  const finite = [...buf].filter(Number.isFinite)
  const avg = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : -Infinity
  return { peak440: Number.isFinite(peak) ? peak : -999, avg: Number.isFinite(avg) ? avg : -999, decryptErrors, encrypted: pub?.isEncrypted ?? false }
}

Object.assign(window, { run, measure })
