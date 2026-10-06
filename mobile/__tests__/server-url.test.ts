import { checkServerUrl, isCleartextAllowedHost, localServerUrl } from '@/config/serverUrl'

const ok = (input: string) => {
  const r = checkServerUrl(input)
  return r.ok ? r.origin : null
}

describe('checkServerUrl — HTTPS', () => {
  it('accepte tout hôte public en https, normalise l’origine', () => {
    expect(ok('https://preprod.example.org')).toBe('https://preprod.example.org')
    expect(ok('  HTTPS://Preprod.Example.org/  ')).toBe('https://preprod.example.org')
    expect(ok('https://example.org:8443')).toBe('https://example.org:8443')
    expect(ok('https://203.0.113.7')).toBe('https://203.0.113.7')
    expect(ok('https://192.168.1.20:8080')).toBe('https://192.168.1.20:8080')
  })
})

describe('checkServerUrl — HTTP limité au réseau local', () => {
  it.each(['http://10.0.2.2:8080', 'http://127.0.0.1:8080', 'http://10.1.2.3', 'http://172.16.0.1:8080', 'http://172.31.255.255', 'http://192.168.1.20:8080'])(
    'accepte %s',
    (u) => expect(ok(u)).toBe(u),
  )

  it.each([
    'http://example.org',
    'http://203.0.113.7:8080',
    'http://8.8.8.8',
    'http://172.15.0.1',
    'http://172.32.0.1',
    'http://192.169.1.1',
    'http://127.0.0.2',
    'http://localhost:8080',
    'http://10.0.2.2.nip.io',
    'http://0.0.0.0:8080',
  ])('refuse %s', (u) => {
    const r = checkServerUrl(u)
    expect(r.ok).toBe(false)
  })
})

describe('checkServerUrl — formes refusées', () => {
  it.each([
    '',
    'example.org',
    'ftp://example.org',
    'javascript:alert(1)',
    'ws://10.0.2.2:8080',
    'https://user:pass@example.org',
    'https://example.org/api',
    'https://example.org?x=1',
    'https://example.org#x',
    'https://exa mple.org',
    'https://-bad.example.org',
    'https://example.org:0',
    'https://example.org:70000',
    'https://256.1.1.1',
    'http://192.168.01.1',
    'https://[::1]:8080',
    'https://10.0.2.2.:8080',
  ])('refuse « %s »', (u) => expect(checkServerUrl(u).ok).toBe(false))
})

describe('isCleartextAllowedHost / localServerUrl', () => {
  it('IPv4 privées, boucle locale et émulateur seulement', () => {
    expect(isCleartextAllowedHost('10.0.2.2')).toBe(true)
    expect(isCleartextAllowedHost('127.0.0.1')).toBe(true)
    expect(isCleartextAllowedHost('192.168.0.10')).toBe(true)
    expect(isCleartextAllowedHost('localhost')).toBe(false)
    expect(isCleartextAllowedHost('100.64.0.1')).toBe(false)
  })

  it('construit http://IP:port pour le serveur local', () => {
    expect(localServerUrl('192.168.1.20')).toEqual({ ok: true, origin: 'http://192.168.1.20:8080' })
    expect(localServerUrl(' 10.0.2.2 ', '3000')).toEqual({ ok: true, origin: 'http://10.0.2.2:3000' })
    expect(localServerUrl('8.8.8.8').ok).toBe(false)
    expect(localServerUrl('192.168.1.20', '99999').ok).toBe(false)
  })
})
