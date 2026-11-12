import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Spacing, withAlpha } from '@/constants/theme';
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
  /** Height of the plot area (bars), without the axis labels. */
  height?: number;
  /** Show only every n-th x-axis label (long months). */
  labelEvery?: number;
  accessibilityLabel: string;
};

const Y_AXIS_WIDTH = 34;
const SECTIONS = 4;
/** Room above the plot so the top value label isn't clipped. */
const TOP_PADDING = 8;
const CORNER_RADIUS = 6;
const TICK_LINE_HEIGHT = 14;

/** Stacked walk/run distance per period (values plotted in km). */
export function DistanceBarChart({ bars, height = 180, labelEvery = 1, accessibilityLabel }: DistanceBarChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const maxKm = niceMax(Math.max(0.5, ...bars.map((bar) => (bar.walkMeters + bar.runMeters) / 1000)));
  const plotWidth = Math.max(0, width - Y_AXIS_WIDTH);
  const slot = bars.length > 0 ? plotWidth / bars.length : 0;
  const barWidth = Math.max(4, Math.min(28, slot * 0.6));
  const baseline = TOP_PADDING + height;
  const yFor = (km: number) => baseline - (km / maxKm) * height;
  const ticks = Array.from({ length: SECTIONS + 1 }, (_, index) => (maxKm * index) / SECTIONS);

  const total = bars.reduce((sum, bar) => sum + bar.walkMeters + bar.runMeters, 0);
  const summary = `${accessibilityLabel}. Total ${formatDistance(total)}.`;

  return (
    <View onLayout={onLayout} accessible accessibilityLabel={summary} style={styles.container}>
      {width > 0 ? (
        <View>
          <View style={styles.row}>
            <View style={{ width: Y_AXIS_WIDTH, height: baseline }}>
              {ticks.map((value) => (
                <AppText key={value} variant="caption" color="textMuted" style={[styles.tick, { top: yFor(value) - TICK_LINE_HEIGHT / 2 }]}>
                  {formatTick(value)}
                </AppText>
              ))}
            </View>
            <Svg width={plotWidth} height={baseline}>
              {ticks.map((value) => (
                <Line
                  key={value}
                  x1={0}
                  x2={plotWidth}
                  // The baseline sits on the bottom edge; keep its whole stroke inside the drawing.
                  y1={Math.min(yFor(value), baseline - 0.5)}
                  y2={Math.min(yFor(value), baseline - 0.5)}
                  stroke={value === 0 ? theme.border : withAlpha(theme.border, 0.6)}
                  strokeWidth={1}
                  strokeDasharray={value === 0 ? undefined : [4, 4]}
                />
              ))}
              {bars.map((bar, index) => {
                const x = index * slot + (slot - barWidth) / 2;
                const walkHeight = (bar.walkMeters / 1000 / maxKm) * height;
                const runHeight = (bar.runMeters / 1000 / maxKm) * height;
                // A 1 px gap separates the two parts of a stacked bar; only the top part is rounded.
                const gap = walkHeight > 0 && runHeight > 0 ? 1 : 0;
                const walkTop = baseline - walkHeight;
                return (
                  <BarParts
                    key={`${bar.label}-${index}`}
                    x={x}
                    width={barWidth}
                    walk={{ top: walkTop, height: walkHeight, color: theme.walk }}
                    run={{ top: walkTop - gap - runHeight, height: runHeight, color: theme.run }}
                  />
                );
              })}
            </Svg>
          </View>
          <View style={[styles.row, { marginLeft: Y_AXIS_WIDTH }]}>
            {bars.map((bar, index) => (
              <AppText
                key={`${bar.label}-${index}`}
                variant="caption"
                color="textMuted"
                numberOfLines={1}
                style={[styles.xLabel, { width: slot }]}>
                {index % labelEvery === 0 ? bar.label : ''}
              </AppText>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.legend}>
        <LegendItem color={theme.walk} label="Walking (km)" />
        <LegendItem color={theme.run} label="Running (km)" />
      </View>
    </View>
  );
}

type Part = { top: number; height: number; color: string };

function BarParts({ x, width, walk, run }: { x: number; width: number; walk: Part; run: Part }) {
  return (
    <>
      {walk.height > 0 ? <Path d={barPath(x, walk.top, width, walk.height, run.height > 0 ? 0 : CORNER_RADIUS)} fill={walk.color} /> : null}
      {run.height > 0 ? <Path d={barPath(x, run.top, width, run.height, CORNER_RADIUS)} fill={run.color} /> : null}
    </>
  );
}

/** Rectangle whose top corners are rounded by `radius` (clamped to the bar's size). */
function barPath(x: number, top: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const bottom = top + height;
  return `M${x},${bottom}V${top + r}A${r},${r} 0 0 1 ${x + r},${top}H${x + width - r}A${r},${r} 0 0 1 ${x + width},${top + r}V${bottom}Z`;
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

/** Up to two decimals without trailing zeros: 0.25, 0.5, 0.75, 1, 12.5. */
function formatTick(value: number): string {
  return String(Number(value.toFixed(2)));
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  row: { flexDirection: 'row' },
  tick: { position: 'absolute', right: 6, fontSize: 11, lineHeight: TICK_LINE_HEIGHT },
  xLabel: { fontSize: 11, lineHeight: TICK_LINE_HEIGHT, textAlign: 'center', marginTop: 4 },
  legend: { flexDirection: 'row', gap: Spacing.lg, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
