import { useState } from 'react'
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { focusedTile, gridShape, togglePin } from '@/features/calls/videoLayout'
import { spacing } from '@/theme'
import { VideoTile, type CallTile } from './VideoTile'

const GAP = spacing.sm
const THUMB = { w: 96, h: 128 }

/**
 * Vidéos d'un appel, façon Discord : grille qui remplit l'écran quand personne n'est épinglé ;
 * sinon la tuile épinglée en grand et un bandeau des autres (toucher une miniature la met en grand).
 * Toucher une vidéo l'ouvre en plein écran (`onOpen`) ; l'épingle se pose par le bouton de la tuile.
 */
export function VideoStage({
  tiles,
  pinned,
  onPin,
  onOpen,
  onLongPress,
}: {
  tiles: CallTile[]
  pinned: string | null
  onPin: (key: string | null) => void
  onOpen: (key: string) => void
  onLongPress?: (tile: CallTile) => void
}) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
  const focused = focusedTile(tiles, pinned)
  const canPin = tiles.length > 1
  const tileProps = (t: CallTile) => ({
    tile: t,
    onPress: t.hasVideo ? () => onOpen(t.key) : undefined,
    onLongPress: onLongPress ? () => onLongPress(t) : undefined,
  })

  if (focused) {
    const others = tiles.filter((t) => t.key !== focused.key)
    return (
      <View style={styles.fill}>
        <View style={[styles.fill, { padding: GAP }]}>
          <VideoTile {...tileProps(focused)} style={styles.fill} pinned onPin={() => onPin(null)} />
        </View>
        {others.length ? (
          <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.stripContent} showsHorizontalScrollIndicator={false}>
            {others.map((t) => (
              // Miniature : la toucher la met en grand (épingle).
              <VideoTile key={t.key} {...tileProps(t)} onPress={() => onPin(t.key)} compact style={THUMB_STYLE} />
            ))}
          </ScrollView>
        ) : null}
      </View>
    )
  }

  const { cols, cellW, cellH } = gridShape(tiles.length, box.w - GAP * 2, box.h - GAP * 2, GAP)
  return (
    <View style={styles.fill} onLayout={onLayout}>
      {cellW > 0 ? (
        <ScrollView contentContainerStyle={[styles.grid, { padding: GAP, paddingBottom: 0 }]}>
          {tiles.map((t, i) => (
            <VideoTile
              key={t.key}
              {...tileProps(t)}
              style={{ width: cellW, height: cellH, marginRight: (i + 1) % cols ? GAP : 0, marginBottom: GAP }}
              onPin={canPin ? () => onPin(togglePin(pinned, t.key)) : undefined}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  )
}

const THUMB_STYLE = { width: THUMB.w, height: THUMB.h }

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  strip: { flexGrow: 0 },
  stripContent: { gap: GAP, paddingHorizontal: GAP, paddingBottom: GAP },
})
