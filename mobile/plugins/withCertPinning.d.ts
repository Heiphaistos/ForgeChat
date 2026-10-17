import type { ConfigPlugin } from '@expo/config-plugins'

declare const withCertPinning: ConfigPlugin<{ apiUrl: string | undefined; livekitHost?: string | null }> & {
  PINS: string[]
  pinnedHost(apiUrl: string | undefined): string | null
  pinnedHosts(apiUrl: string | undefined, livekitHost?: string | null): string[]
  networkSecurityConfigXml(hosts: string | string[]): string
  pinnedDomainsPlist(hosts: string | string[]): Record<string, unknown>
}
export = withCertPinning
