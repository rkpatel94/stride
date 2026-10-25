import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { Fonts, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance } from '@/utils/format';

import { AppText } from './AppText';

export type ChartBar = {
  label: string;
  walkMeters: number;
  runMeters: number;
};

type DistanceBarChartProps = {
  bars: ChartBar[];
  height?: number;
  /** Show only every n-th x-axis label (long months). */
  labelEvery?: number;
  accessibilityLabel: string;
};

/** Stacked walk/run distance per period (values plotted in km). */
export function DistanceBarChart({ bars, height = 180, labelEvery = 1, accessibilityLabel }: DistanceBarChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const maxKm = Math.max(0.5, ...bars.map((bar) => (bar.walkMeters + bar.runMeters) / 1000));
  const yAxisWidth = 34;
  const available = Math.max(0, width - yAxisWidth - 16);
  const slot = bars.length > 0 ? available / bars.length : 0;
  const barWidth = Math.max(4, Math.min(28, slot * 0.6));
  const spacing = Math.max(2, slot - barWidth);

  const stackData = bars.map((bar, index) => ({
    label: index % labelEvery === 0 ? bar.label : '',
    stacks: [
      { value: bar.walkMeters / 1000, color: theme.walk },
      { value: bar.runMeters / 1000, color: theme.run, marginBottom: bar.walkMeters > 0 && bar.runMeters > 0 ? 1 : 0 },
    ],
  }));
  const total = bars.reduce((sum, bar) => sum + bar.walkMeters + bar.runMeters, 0);
  const summary = `${accessibilityLabel}. Total ${formatDistance(total)}.`;

  return (
    <View onLayout={onLayout} accessible accessibilityLabel={summary} style={styles.container}>
      {width > 0 ? (
        <BarChart
          stackData={stackData}
          width={available}
          height={height}
          barWidth={barWidth}
          spacing={spacing}
          initialSpacing={spacing / 2}
          maxValue={niceMax(maxKm)}
          noOfSections={4}
          yAxisLabelWidth={yAxisWidth}
          yAxisTextStyle={{ color: theme.textMuted, fontSize: 11, fontFamily: Fonts.body[500] }}
          xAxisLabelTextStyle={{ color: theme.textMuted, fontSize: 11, fontFamily: Fonts.body[500] }}
          yAxisColor="transparent"
          xAxisColor={theme.border}
          rulesColor={withAlpha(theme.border, 0.6)}
          rulesType="dashed"
          barBorderTopLeftRadius={6}
          barBorderTopRightRadius={6}
          disableScroll
          formatYLabel={(label: string) => trimLabel(label)}
        />
      ) : null}
      <View style={styles.legend}>
        <LegendItem color={theme.walk} label="Walking (km)" />
        <LegendItem color={theme.run} label="Running (km)" />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <AppText variant="caption" color="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

function niceMax(value: number): number {
  const steps = [0.5, 1, 2, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500];
  return steps.find((step) => step >= value) ?? Math.ceil(value / 100) * 100;
}

function trimLabel(label: string): string {
  const value = Number(label);
  if (!Number.isFinite(value)) return label;
  // Up to two decimals without trailing zeros: 0.25, 0.5, 0.75, 1, 12.5.
  return String(Number(value.toFixed(2)));
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  legend: { flexDirection: 'row', gap: Spacing.lg, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
