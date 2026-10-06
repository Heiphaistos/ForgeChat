import type { ConfigPlugin } from '@expo/config-plugins'

declare const withStripBuildPaths: ConfigPlugin & {
  applyStripBuildPaths(src: string): string
}
export = withStripBuildPaths
