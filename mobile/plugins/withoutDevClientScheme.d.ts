import type { ConfigPlugin } from '@expo/config-plugins'

declare const withoutDevClientScheme: ConfigPlugin & {
  removeDevClientSchemes<T = any>(manifest: T): T
}
export = withoutDevClientScheme
