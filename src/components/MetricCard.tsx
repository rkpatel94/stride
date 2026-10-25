import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

type MetricProps = {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  accent?: string;
  icon?: IconName;
  size?: 'normal' | 'large';
  style?: StyleProp<ViewStyle>;
};

/** A labelled value, e.g. "DISTANCE 3.42 km". Used on cards and the live tracking panel. */
export function Metric({ label, value, unit, caption, accent, icon, size = 'normal', style }: MetricProps) {
  const theme = useTheme();
  return (
    <View style={[styles.metric, style]} accessible accessibilityLabel={`${label} ${value}${unit ? ` ${unit}` : ''}`}>
      <View style={styles.labelRow}>
        {icon ? <Icon name={icon} size={14} color={accent ?? theme.textMuted} /> : null}
        <AppText variant="label" color="textMuted">
          {label.toUpperCase()}
        </AppText>
      </View>
      <View style={styles.valueRow}>
        <AppText variant={size === 'large' ? 'hero' : 'metric'} tint={accent} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </AppText>
        {unit ? (
          <AppText variant="body" weight="500" color="textMuted" style={size === 'large' ? styles.largeUnit : undefined}>
            {unit}
          </AppText>
        ) : null}
      </View>
      {caption ? (
        <AppText variant="caption" color="textSecondary">
          {caption}
        </AppText>
      ) : null}
    </View>
  );
}

export function MetricCard(props: MetricProps) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, props.style]}>
      <Metric {...props} style={undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  metric: { gap: 2, flexShrink: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs },
  largeUnit: { fontSize: 22, lineHeight: 28 },
  card: {
    flex: 1,
    minWidth: 140,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
  },
});
