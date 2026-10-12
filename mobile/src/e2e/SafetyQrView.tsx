// Code de sécurité en QR code (amélioration n° 11) : affiché sans dépendance native (matrice de
// `qrcode` dessinée en vues), scanné avec la caméra (expo-camera). Seule une égalité stricte
// des 60 chiffres marque le contact vérifié (safetyQr.ts, identique au web).
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useMemo, useRef, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { Button, T } from '@/components/ui'
import { useT } from '@/i18n'
import { colors, radius, spacing } from '@/theme'
import { compareSafetyScan, qrRows, safetyPayload, type SafetyScan } from './safetyQr'

export function SafetyQrImage({ code, px = 180 }: { code: string; px?: number }) {
  const { size, rows } = useMemo(() => qrRows(safetyPayload(code)), [code])
  const quiet = 2
  const cell = px / (size + quiet * 2)
  return (
    <View style={{ width: px, height: px, backgroundColor: '#fff', borderRadius: radius.md }} accessible={false}>
      {rows.map((runs, y) =>
        runs.map(([x, w]) => (
          <View key={`${y}-${x}`} style={{ position: 'absolute', backgroundColor: '#000', top: (y + quiet) * cell, left: (x + quiet) * cell, width: w * cell + 0.5, height: cell + 0.5 }} />
        )),
      )}
    </View>
  )
}

export function SafetyQrScanner({ code, onResult }: { code: string; onResult: (r: SafetyScan) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()
  const done = useRef(false)

  const start = async () => {
    const p = permission?.granted ? permission : await requestPermission()
    if (!p.granted) return onResult('invalid')
    done.current = false
    setOpen(true)
  }

  return (
    <>
      <Button title={t('guard.qr.scan')} variant="secondary" icon="qr-code-outline" onPress={() => void start()} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.full}>
          {open ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (done.current || !data.startsWith('FCSAFE1:')) return
                done.current = true
                setOpen(false)
                onResult(compareSafetyScan(data, code))
              }}
            />
          ) : null}
          <View style={styles.bottom}>
            <T style={{ color: '#fff', textAlign: 'center' }}>{t('guard.qr.hint')}</T>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: '#000' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.xl, gap: spacing.md, backgroundColor: colors.overlay },
})
