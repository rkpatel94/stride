import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { DistanceBarChart } from '@/components/DistanceBarChart';
import { Banner, EmptyState, LoadingState, SectionHeader } from '@/components/Feedback';
import { MetricCard } from '@/components/MetricCard';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Spacing } from '@/constants/theme';
import { listActivitySummaries } from '@/database/activityRepository';
import { getPreferences } from '@/database/preferencesRepository';
import {
  computeStreaks,
  monthlySummary,
  personalRecords,
  weeklySummary,
  weeklyTrend,
  type ComparedPeriod,
} from '@/features/statistics/statistics';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';
import { useTheme } from '@/hooks/use-theme';
import { weekdayLabel } from '@/utils/dates';
import {
  formatDistance,
  formatDurationShort,
  formatKilometers,
  formatPace,
  formatShortDate,
} from '@/utils/format';

type Period = 'week' | 'month';

export default function StatisticsScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('week');
  const { data, error, loading } = useDatabaseQuery(async (db) => {
    const [summaries, preferences] = await Promise.all([listActivitySummaries(db), getPreferences(db)]);
    const now = Date.now();
    return {
      week: weeklySummary(summaries, now, preferences.weekStartsOn),
      month: monthlySummary(summaries, now),
      trend: weeklyTrend(summaries, now, 12, preferences.weekStartsOn),
      streaks: computeStreaks(summaries, now),
      records: personalRecords(summaries, preferences.weekStartsOn),
      count: summaries.length,
    };
  }, []);

  const selected: ComparedPeriod | null = data ? (period === 'week' ? data.week : data.month) : null;

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        Statistics
      </AppText>
      <SegmentedControl
        accessibilityLabel="Statistics period"
        options={[
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
        ]}
        value={period}
        onChange={setPeriod}
      />
      {error ? <Banner tone="error" title="Could not load statistics" message={error} /> : null}
      {!data && loading ? <LoadingState /> : null}

      {data && data.count === 0 ? (
        <Card>
          <EmptyState icon="chart-bar" title="No statistics yet" message="Finish your first walk or run to see weekly and monthly trends here." />
        </Card>
      ) : null}

      {data && selected && data.count > 0 ? (
        <>
          <Card>
            <AppText variant="label" color="textSecondary">
              {period === 'week' ? 'DISTANCE THIS WEEK' : 'DISTANCE THIS MONTH'}
            </AppText>
            <View style={styles.totalRow}>
              <AppText variant="hero">{formatKilometers(selected.current.totalDistanceMeters)}</AppText>
              <AppText variant="heading" color="textSecondary">
                km
              </AppText>
            </View>
            <AppText color="textSecondary">{comparisonText(selected, period)}</AppText>
            <DistanceBarChart
              accessibilityLabel={period === 'week' ? 'Distance per day this week' : 'Distance per day this month'}
              labelEvery={period === 'week' ? 1 : 5}
              bars={selected.days.map((day, index) => ({
                label: period === 'week' ? weekdayLabel(day.startMs) : String(index + 1),
                walkMeters: day.walkMeters,
                runMeters: day.runMeters,
              }))}
            />
          </Card>

          <View style={styles.grid}>
            <MetricCard label="Walking" value={formatKilometers(selected.current.walkDistanceMeters)} unit="km" accent={theme.walk} caption={`${selected.current.walkCount} ${selected.current.walkCount === 1 ? 'walk' : 'walks'}`} />
            <MetricCard label="Running" value={formatKilometers(selected.current.runDistanceMeters)} unit="km" accent={theme.run} caption={`${selected.current.runCount} ${selected.current.runCount === 1 ? 'run' : 'runs'}`} />
          </View>
          <View style={styles.grid}>
            <MetricCard label="Active time" value={formatDurationShort(selected.current.activeDurationSeconds)} />
            <MetricCard label="Avg pace" value={formatPace(selected.current.averagePaceSecondsPerKm)} unit="/km" caption="All eligible activities" />
          </View>
          <View style={styles.grid}>
            <MetricCard label="Activities" value={String(selected.current.activityCount)} />
            <MetricCard label="Previous" value={formatKilometers(selected.previous.totalDistanceMeters)} unit="km" caption={period === 'week' ? 'Last week' : 'Last month'} />
          </View>

          <SectionHeader title="12-week trend" />
          <Card>
            <DistanceBarChart
              accessibilityLabel="Distance per week for the last 12 weeks"
              labelEvery={3}
              bars={data.trend.map((week) => ({ label: formatShortDate(week.startMs), walkMeters: week.totalMeters, runMeters: 0 }))}
            />
            <AppText variant="caption" color="textMuted">
              Weekly totals (walking and running combined).
            </AppText>
          </Card>

          <SectionHeader title="Records" actionLabel="Achievements" onAction={() => router.push('/goals')} />
          <Card>
            <RecordRow
              label="Longest activity"
              value={data.records.longestDistance ? formatDistance(data.records.longestDistance.value) : '—'}
              onPress={data.records.longestDistance ? () => router.push(`/activity/${data.records.longestDistance?.activityId}`) : undefined}
            />
            <RecordRow
              label="Fastest average pace (≥ 1 km)"
              value={data.records.fastestPace ? `${formatPace(data.records.fastestPace.value)} /km` : '—'}
              onPress={data.records.fastestPace ? () => router.push(`/activity/${data.records.fastestPace?.activityId}`) : undefined}
            />
            <RecordRow
              label="Highest weekly distance"
              value={data.records.highestWeek ? `${formatDistance(data.records.highestWeek.totalMeters)} · ${formatShortDate(data.records.highestWeek.startMs)}` : '—'}
            />
            <RecordRow
              label="Highest monthly distance"
              value={
                data.records.highestMonth
                  ? `${formatDistance(data.records.highestMonth.totalMeters)} · ${new Date(data.records.highestMonth.startMs).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
                  : '—'
              }
            />
            <RecordRow label="Lifetime distance" value={formatDistance(data.records.lifetimeDistanceMeters, { alwaysKm: true })} />
            <RecordRow label="Lifetime active time" value={formatDurationShort(data.records.lifetimeActiveSeconds)} />
            <RecordRow label="Current streak" value={`${data.streaks.current} ${data.streaks.current === 1 ? 'day' : 'days'}`} />
            <RecordRow label="Longest streak" value={`${data.streaks.longest} ${data.streaks.longest === 1 ? 'day' : 'days'}`} />
          </Card>
          <AppText variant="caption" color="textMuted">
            Activities count toward the local day, week and month in which they started; weeks start on the day chosen in
            Settings (Monday by default). Streaks, records and average pace include activities of at least 100 m and 1
            minute.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

function comparisonText(period: ComparedPeriod, kind: Period): string {
  const label = kind === 'week' ? 'last week' : 'last month';
  if (period.distanceChange === null) {
    return period.current.totalDistanceMeters > 0 ? `Nothing recorded ${label}.` : 'Nothing recorded yet in this period.';
  }
  const percent = Math.round(Math.abs(period.distanceChange) * 100);
  if (percent === 0) return `Same distance as ${label}.`;
  return `${percent}% ${period.distanceChange > 0 ? 'more' : 'less'} than ${label} (${formatDistance(period.previous.totalDistanceMeters)}).`;
}

function RecordRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.recordRow}>
      <AppText color="textSecondary" style={styles.flex}>
        {label}
      </AppText>
      <AppText weight="700" tint={onPress ? theme.accent : undefined} onPress={onPress} accessibilityRole={onPress ? 'link' : undefined}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  grid: { flexDirection: 'row', gap: Spacing.md },
  recordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36, gap: Spacing.md },
});
