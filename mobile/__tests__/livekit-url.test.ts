import { checkLiveKitUrl, parseLiveKitAccess } from '@/config/livekitUrl'

const beta = { appEnv: 'production', apiHost: 'chat.example.org' }
const dev = { appEnv: 'preview', apiHost: '10.0.2.2' }
const ok = (raw: unknown, p: Parameters<typeof checkLiveKitUrl>[1]) => {
  const r = checkLiveKitUrl(raw, p)
  return r.ok ? r.url : null
}

describe('LiveKit — bêta (production)', () => {
  it('wss:// sur l’hôte du serveur, avec chemin et port', () => {
    expect(ok('wss://chat.example.org/livekit', beta)).toBe('wss://chat.example.org/livekit')
    expect(ok('WSS://Chat.Example.org:443/livekit', beta)).toBe('wss://chat.example.org:443/livekit')
  })

  it('refuse ws://, un autre hôte, une IP', () => {
    expect(ok('ws://chat.example.org/livekit', beta)).toBeNull()
    expect(ok('wss://evil.example.net/livekit', beta)).toBeNull()
    expect(ok('wss://chat.example.org.evil.net', beta)).toBeNull()
    expect(ok('wss://203.0.113.7:7880', beta)).toBeNull()
    expect(ok('wss://192.168.1.20:7880', beta)).toBeNull()
  })

  it('hôte LiveKit fixé au build', () => {
    const pinned = { ...beta, pinnedHost: 'media.example.org' }
    expect(ok('wss://media.example.org', pinned)).toBe('wss://media.example.org')
    expect(ok('wss://chat.example.org/livekit', pinned)).toBeNull()
  })
})

describe('LiveKit — APK DEV / development', () => {
  it('wss:// partout, ws:// seulement en réseau local', () => {
    expect(ok('wss://preprod.example.org/livekit', dev)).toBe('wss://preprod.example.org/livekit')
    expect(ok('ws://192.168.1.20:7880', dev)).toBe('ws://192.168.1.20:7880')
    expect(ok('ws://10.0.2.2:7880', dev)).toBe('ws://10.0.2.2:7880')
    expect(ok('ws://203.0.113.7:7880', dev)).toBeNull()
    expect(ok('ws://preprod.example.org', dev)).toBeNull()
  })
})

describe('formes refusées', () => {
  it.each([undefined, '', 'https://chat.example.org', 'wss://user:pw@chat.example.org', 'wss://chat.example.org/?x=1', 'wss://chat.example.org#a', 'wss://..', 'wss://chat.example.org:70000', 'javascript:alert(1)'])(
    'refuse %p',
    (raw) => expect(checkLiveKitUrl(raw, beta).ok).toBe(false),
  )
})

describe('parseLiveKitAccess', () => {
  it('accès valide', () => {
    const r = parseLiveKitAccess({ url: 'wss://chat.example.org/livekit', token: 'x'.repeat(40), room: 'dm-1' }, beta)
    expect(r).toEqual({ access: { url: 'wss://chat.example.org/livekit', token: 'x'.repeat(40), room: 'dm-1', e2ee: false, convId: null } })
  })
  it('salle chiffrée de bout en bout : e2ee et conversation', () => {
    const r = parseLiveKitAccess({ url: 'wss://chat.example.org/livekit', token: 'x'.repeat(40), e2ee: true, conv_id: 'abc' }, beta)
    expect(r).toEqual({ access: { url: 'wss://chat.example.org/livekit', token: 'x'.repeat(40), room: null, e2ee: true, convId: 'abc' } })
  })
  it('jeton absent ou URL refusée : erreur claire', () => {
    expect(parseLiveKitAccess(null, beta)).toEqual({ error: 'Serveur audio/vidéo indisponible.' })
    expect(parseLiveKitAccess({ url: 'ws://chat.example.org', token: 'x'.repeat(40) }, beta)).toEqual({
      error: 'Serveur audio/vidéo refusé : connexion non chiffrée.',
    })
  })
})
