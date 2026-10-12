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
