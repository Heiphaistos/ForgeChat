import type { ConfigPlugin } from '@expo/config-plugins'

declare const withCertPinning: ConfigPlugin<{ apiUrl: string | undefined }> & {
  PINS: string[]
  pinnedHost(apiUrl: string | undefined): string | null
  networkSecurityConfigXml(host: string): string
  pinnedDomainsPlist(host: string): Record<string, unknown>
}
export = withCertPinning
