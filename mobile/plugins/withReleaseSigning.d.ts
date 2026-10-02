import type { ConfigPlugin } from '@expo/config-plugins'

declare const withReleaseSigning: ConfigPlugin & {
  applyReleaseSigning(src: string): string
}
export = withReleaseSigning
