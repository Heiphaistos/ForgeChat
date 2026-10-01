import type { ConfigPlugin } from '@expo/config-plugins'

declare const withLanCleartext: ConfigPlugin<{ host: string | null }> & {
  isPrivateIpv4(host: string): boolean
  lanCleartextHost(apiUrl: string | undefined): string | null
  networkSecurityConfigXml(host: string | null): string
}
export = withLanCleartext
