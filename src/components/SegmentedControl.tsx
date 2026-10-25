import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './AppText';

type Option<T extends string> = { value: T; label: string };

type SegmentedControlProps<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
};

/** Pill toggle; the selected segment is a volt pill. */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: SegmentedControlProps<T>) {
  const theme = useTheme();
  return (
    <View
      style={[styles.container, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.option, selected && { backgroundColor: theme.primary }]}>
            <AppText variant="body" weight={selected ? '700' : '500'} tint={selected ? theme.onPrimary : theme.textSecondary}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

type ChipsProps<T extends string> = SegmentedControlProps<T>;

/** Horizontally wrapping filter chips. */
export function Chips<T extends string>({ options, value, onChange, accessibilityLabel }: ChipsProps<T>) {
  const theme = useTheme();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? theme.primary : theme.surfaceAlt,
                borderColor: selected ? theme.primaryBorder : theme.border,
              },
            ]}>
            <AppText variant="label" weight={selected ? '700' : '600'} tint={selected ? theme.onPrimary : theme.text}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', borderRadius: Radius.pill, borderWidth: 1, padding: Spacing.xs, gap: Spacing.xs },
  option: {
    flex: 1,
    minHeight: TouchTarget.min - 6,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    minHeight: 40,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
