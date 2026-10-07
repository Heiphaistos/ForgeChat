import { StyleSheet, View } from 'react-native'
import { RTCView } from '@livekit/react-native-webrtc'
import { updatePipRatio } from '@/services/callWindow'
import type { CallTile } from './VideoTile'

/** Contenu de la fenêtre image dans l'image : la vidéo principale seule, à son vrai ratio. */
export function PipView({ tile }: { tile: CallTile | null }) {
  return (
    <View style={styles.root}>
      {tile?.stream ? (
        <RTCView
          streamURL={tile.stream.toURL()}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={!!tile.mirror}
          onDimensionsChange={(e) => updatePipRatio(e.nativeEvent.width, e.nativeEvent.height)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#000' } })
