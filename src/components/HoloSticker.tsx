import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type HoloStickerProps = {
  icon: IconName;
  label?: string;
  /** Degrees; alternate small tilts so a row looks hand-placed. */
  tilt?: number;
  size?: number;
  locked?: boolean;
};

/** Achievement sticker: die-cut holographic foil when unlocked, a dashed silhouette when locked. */
export function HoloSticker({ icon, label, tilt = 0, size = 64, locked = false }: HoloStickerProps) {
  const theme = useTheme();
  const radius = Math.round(size / 4);
  return (
    <View style={[styles.sticker, { width: label ? Math.max(size, 72) : size }]}>
      {locked ? (
        <View
          style={[
            styles.locked,
            { width: size, height: size, borderRadius: radius, backgroundColor: theme.surfaceAlt, borderColor: theme.border },
          ]}>
          <Icon name={icon} size={size * 0.42} color={theme.textMuted} />
          <View style={[styles.lock, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Icon name="lock" size={11} color={theme.textMuted} />
          </View>
        </View>
      ) : (
        // The shadow sits on an outer view so the clipped foil inside cannot cut it off.
        <View
          style={{
            borderRadius: radius,
            transform: [{ rotate: `${tilt}deg` }],
            boxShadow: theme.scheme === 'dark' ? '0px 6px 16px -2px rgba(165, 243, 255, 0.25)' : `0px 4px 10px ${theme.shadow}`,
          }}>
          <View style={[styles.foil, { width: size, height: size, borderRadius: radius }]}>
            <LinearGradient
              colors={[theme.holoStart, theme.holoMid, theme.holoEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={['transparent', 'rgba(255, 255, 255, 0.45)', 'transparent']}
              start={{ x: 0, y: 1 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <Icon name={icon} size={size * 0.47} color="#0A0B0F" />
          </View>
        </View>
      )}
      {label ? (
        <AppText variant="label" align="center" color={locked ? 'textMuted' : 'text'} numberOfLines={2} style={styles.label}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sticker: { alignItems: 'center', gap: 6 },
  foil: {
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  lock: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, lineHeight: 14, letterSpacing: 0.2 },
});
