// Épinglage des autorités de certification (amélioration n° 20).
import withCertPinning from '../plugins/withCertPinning.js'

test('seul un nom DNS en https est épinglé', () => {
  expect(withCertPinning.pinnedHost('https://forgechat.heiphaistos.org')).toBe('forgechat.heiphaistos.org')
  expect(withCertPinning.pinnedHost('http://forgechat.heiphaistos.org')).toBeNull()
  expect(withCertPinning.pinnedHost('https://192.168.1.20:8080')).toBeNull()
  expect(withCertPinning.pinnedHost('https://localhost')).toBeNull()
  expect(withCertPinning.pinnedHost(undefined)).toBeNull()
})

test('Android : pin-set avec expiration, aucun clair ; iOS : NSPinnedCAIdentities', () => {
  const xml = withCertPinning.networkSecurityConfigXml('forgechat.heiphaistos.org')
  expect(xml).toContain('<pin-set expiration="')
  expect(xml).toContain('cleartextTrafficPermitted="false"')
  expect(xml.match(/<pin digest="SHA-256">/g)).toHaveLength(withCertPinning.PINS.length)
  const plist = withCertPinning.pinnedDomainsPlist('forgechat.heiphaistos.org') as Record<string, { NSPinnedCAIdentities: unknown[] }>
  expect(plist['forgechat.heiphaistos.org']!.NSPinnedCAIdentities).toHaveLength(6)
  // Empreintes SPKI SHA-256 : 32 octets en base64.
  for (const p of withCertPinning.PINS) expect(Buffer.from(p, 'base64')).toHaveLength(32)
})

test('hôte LiveKit épinglé en plus de l API ; pin-set valable au moins jusqu en 2030', () => {
  expect(withCertPinning.pinnedHosts('https://a.example.org', 'lk.example.org:7881')).toEqual(['a.example.org', 'lk.example.org'])
  expect(withCertPinning.pinnedHosts('https://a.example.org', null)).toEqual(['a.example.org'])
  expect(withCertPinning.pinnedHosts('https://a.example.org', '10.0.0.1:7881')).toEqual(['a.example.org'])
  expect(withCertPinning.pinnedHosts('http://a.example.org', 'lk.example.org')).toEqual([])
  const xml = withCertPinning.networkSecurityConfigXml(['a.example.org', 'lk.example.org'])
  expect(xml).toContain('>lk.example.org</domain>')
  expect(xml).toContain('expiration="2030-01-01"')
})
