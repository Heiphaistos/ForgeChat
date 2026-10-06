import lan from '../plugins/withLanCleartext.js'

const { isPrivateIpv4, lanCleartextHost, networkSecurityConfigXml } = lan

describe('profil LAN : HTTP en clair limité à une IPv4 privée', () => {
  it('reconnaît les plages privées RFC 1918 et rien d’autre', () => {
    for (const ip of ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.1.20']) {
      expect(isPrivateIpv4(ip)).toBe(true)
    }
    for (const ip of [
      '172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.1',
      '8.8.8.8', '0.0.0.0', '256.1.1.1', '192.168.1', '192.168.01.2', 'localhost', 'example.org', '::1',
    ]) {
      expect(isPrivateIpv4(ip)).toBe(false)
    }
  })

  it('renvoie l’hôte à autoriser pour une URL http vers une IPv4 privée', () => {
    expect(lanCleartextHost('http://192.168.1.20:8080')).toBe('192.168.1.20')
    expect(lanCleartextHost('http://10.0.0.5')).toBe('10.0.0.5')
    expect(lanCleartextHost('http://172.20.3.4:8080/')).toBe('172.20.3.4')
  })

  it('n’ajoute aucune exception en https', () => {
    expect(lanCleartextHost('https://192.168.1.20:8443')).toBeNull()
  })

  it('fait échouer le build pour tout le reste', () => {
    for (const url of [
      undefined, '', 'pas une url', 'ftp://192.168.1.20', 'http://forgechat.example.org', 'http://8.8.8.8',
      'http://127.0.0.1:8080', 'http://10.0.2.2:8080/api', 'http://192.168.1.20:8080?x=1',
      'http://user:pw@192.168.1.20', 'http://[::1]:8080', 'http://192.168.1.20.nip.io',
    ]) {
      expect(() => lanCleartextHost(url)).toThrow(/APP_ENV=lan/)
    }
  })

  it('écrit un network_security_config qui n’autorise que cet hôte', () => {
    const xml = networkSecurityConfigXml('192.168.1.20')
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />')
    expect(xml.match(/cleartextTrafficPermitted="true"/g)).toHaveLength(1)
    expect(xml).toContain('<domain includeSubdomains="false">192.168.1.20</domain>')
    expect(networkSecurityConfigXml(null)).not.toContain('cleartextTrafficPermitted="true"')
  })
})
