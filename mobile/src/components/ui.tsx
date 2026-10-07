import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { forwardRef, useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { colors, font, outline, outlined, radius, spacing } from '@/theme'
import { useT } from '@/i18n'
import { unreadLabel } from '@/lib/format'
import { eyeIcon, eyeLabel, maskOnAppState } from '@/lib/passwordVisibility'

export type IconName = ComponentProps<typeof Ionicons>['name']

// ─── Texte ───────────────────────────────────────────────────────────────────

export function T({
  children,
  style,
  variant = 'body',
  numberOfLines,
  selectable,
}: {
  children: ReactNode
  style?: StyleProp<TextStyle>
  variant?: 'title' | 'subtitle' | 'body' | 'muted' | 'small' | 'label' | 'error'
  numberOfLines?: number
  selectable?: boolean
}) {
  return (
    <Text style={[styles[variant], style]} numberOfLines={numberOfLines} selectable={selectable}>
      {children}
    </Text>
  )
}

// ─── Boutons ────────────────────────────────────────────────────────────────

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
  icon?: IconName
  style?: StyleProp<ViewStyle>
}

export function Button({ title, variant = 'primary', loading, icon, disabled, style, ...rest }: ButtonProps) {
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.bgElevated : 'transparent'
  // Blanc sur les fonds colorés (comme le web), couleur du texte du thème sinon (thèmes clairs).
  const fg = variant === 'primary' || variant === 'danger' ? '#fff' : variant === 'ghost' ? colors.primary : colors.text
  return (
    <Pressable
      accessibilityRole="button"
      // Libellé explicite : sinon Android lit le glyphe de l'icône, et garde « busy » après un chargement.
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        variant === 'secondary' && outline,
        variant === 'ghost' && styles.buttonGhost,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  )
}

export function IconButton({
  icon,
  onPress,
  label,
  color = colors.textSecondary,
  size = 22,
  active,
  danger,
  disabled,
  style,
}: {
  icon: IconName
  onPress: () => void
  label: string
  color?: string
  size?: number
  active?: boolean
  danger?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        active && { backgroundColor: colors.bgHover },
        danger && { backgroundColor: colors.danger },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={danger ? '#fff' : color} />
    </Pressable>
  )
}

// ─── Champs ─────────────────────────────────────────────────────────────────

interface FieldProps extends TextInputProps {
  label?: string
  error?: string | null
}

export const TextField = forwardRef<TextInput, FieldProps>(function TextField({ label, error, style, ...rest }, ref) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.primary}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
})

/**
 * Champ de mot de passe avec bouton œil (afficher / masquer). Utilisé pour TOUS les champs masqués.
 * Repasse masqué quand l'écran perd le focus ou quand l'app passe en arrière-plan.
 */
export const PasswordField = forwardRef<TextInput, Omit<FieldProps, 'secureTextEntry'>>(function PasswordField(
  { label, error, style, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false)
  useFocusEffect(useCallback(() => () => setVisible(false), []))
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (maskOnAppState(state)) setVisible(false)
    })
    return () => sub.remove()
  }, [])
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
          secureTextEntry={!visible}
          style={[styles.input, error ? { borderColor: colors.danger } : null, style, { paddingRight: 48 }]}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={eyeLabel(visible)}
          hitSlop={4}
          style={({ pressed }) => [styles.eye, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name={eyeIcon(visible)} size={22} color={colors.textMuted} />
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
})

// ─── Listes / réglages ──────────────────────────────────────────────────────

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  return (
    <View style={{ marginBottom: spacing.xl }}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
      {footer ? <Text style={styles.sectionFooter}>{footer}</Text> : null}
    </View>
  )
}

export function Row({
  icon,
  title,
  subtitle,
  onPress,
  right,
  danger,
  chevron,
  selected,
}: {
  icon?: IconName
  title: string
  subtitle?: string | null
  onPress?: () => void
  right?: ReactNode
  danger?: boolean
  chevron?: boolean
  /** Option cochée dans une liste de choix (annoncé par le lecteur d'écran). */
  selected?: boolean
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      // Libellé explicite : sinon Android lit aussi les glyphes des icônes.
      accessibilityLabel={onPress ? [title, subtitle].filter(Boolean).join(', ') : undefined}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      style={({ pressed }) => [styles.row, pressed && onPress ? { backgroundColor: colors.bgHover } : null]}
    >
      {icon ? <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.textMuted} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
    </Pressable>
  )
}

export function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
}: {
  icon?: IconName
  title: string
  subtitle?: string
  value: boolean
  onValueChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <Row
      icon={icon}
      title={title}
      subtitle={subtitle}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: colors.primary, false: colors.bgHover }}
          thumbColor="#fff"
          accessibilityLabel={title}
        />
      }
    />
  )
}

// ─── États ──────────────────────────────────────────────────────────────────

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={[styles.muted, { marginTop: spacing.md }]}>{label}</Text> : null}
    </View>
  )
}

export function EmptyState({ icon, title, subtitle, action }: { icon: IconName; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={[styles.center, { padding: spacing.xxl }]}>
      <Ionicons name={icon} size={48} color={colors.textFaint} />
      <Text style={[styles.subtitle, { marginTop: spacing.md, textAlign: 'center' }]}>{title}</Text>
      {subtitle ? <Text style={[styles.muted, { textAlign: 'center', marginTop: spacing.xs }]}>{subtitle}</Text> : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT()
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={t('common.oops')}
      subtitle={message}
      action={onRetry ? <Button title={t('common.retry')} variant="secondary" onPress={onRetry} /> : undefined}
    />
  )
}

export function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <View style={styles.badge} accessibilityLabel={unreadLabel(count)}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  )
}

export const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '800' },
  subtitle: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  body: { color: colors.textSecondary, fontSize: font.md, lineHeight: 21 },
  muted: { color: colors.textMuted, fontSize: font.sm },
  small: { color: colors.textMuted, fontSize: font.xs },
  label: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  error: { color: colors.danger, fontSize: font.sm },
  button: { minHeight: 46, borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  buttonGhost: { minHeight: 40 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonText: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  iconButton: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  eye: { position: 'absolute', right: 2, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' },
  input: {
    backgroundColor: colors.bgDeep,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: font.md,
    borderWidth: 1,
    borderColor: outlined ? colors.border : 'transparent',
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  sectionBody: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, overflow: 'hidden', ...outline },
  sectionFooter: { color: colors.textFaint, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  rowTitle: { color: colors.text, fontSize: font.md, fontWeight: '500' },
  rowSubtitle: { color: colors.textMuted, fontSize: font.sm, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
})
