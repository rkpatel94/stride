import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ActivityCard } from '@/components/ActivityCard';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Banner, EmptyState, LoadingState, SectionHeader } from '@/components/Feedback';
import { GoalRing } from '@/components/GoalRing';
import { HoloSticker } from '@/components/HoloSticker';
import { achievementIcon, Icon, type IconName } from '@/components/Icon';
import { RouteThumbnail } from '@/components/RouteThumbnail';
import { Screen } from '@/components/Screen';
import { glow, Radius, Spacing, withAlpha } from '@/constants/theme';
import { definitionFor } from '@/features/achievements/achievements';
import { loadDashboard, type DashboardData } from '@/features/statistics/dashboardData';
import type { ComparedPeriod } from '@/features/statistics/statistics';
import { describeInterruption } from '@/features/tracking/permissions';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';
import { useTheme } from '@/hooks/use-theme';
import { useTrackingSnapshot } from '@/hooks/useTracking';
import { formatAccuracy, formatDistance, formatDurationShort, formatKilometers, formatPace } from '@/utils/format';

const STICKER_TILTS = [-2, 3, -3, 2];
const COLLAGE = { width: 168, height: 112 };

export default function DashboardScreen() {
  const tracking = useTrackingSnapshot();
  const { data, error, loading } = useDatabaseQuery((db) => loadDashboard(db), []);

  const startActivity = (type: 'walk' | 'run') => router.navigate({ pathname: '/track', params: { start: type } });
  const sessionActive = tracking.activityId !== null;

  return (
    <Screen header={<TopBar />}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <AppText variant="title" accessibilityRole="header">
            Today
          </AppText>
          <AppText variant="caption" color="textSecondary" style={styles.date}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </AppText>
        </View>
        <PrivacyChip />
      </View>

      {sessionActive ? (
        <Banner
          tone={tracking.phase === 'recovering' ? 'warning' : 'info'}
          title={
            tracking.phase === 'recovering'
              ? 'A workout was interrupted'
              : `${tracking.activityType === 'run' ? 'Run' : 'Walk'} in progress · ${formatDistance(tracking.distanceMeters)}`
          }
          message={tracking.phase === 'recovering' ? describeInterruption(tracking.recovery?.reason ?? null) : undefined}
          actionLabel="Open tracker"
          onAction={() => router.navigate('/track')}
        />
      ) : null}

      <View style={styles.row}>
        <Button
          label="Start walk"
          icon="walk"
          variant="walk"
          style={styles.flex}
          disabled={sessionActive}
          onPress={() => startActivity('walk')}
          accessibilityHint="Opens the tracker and starts recording a walk"
        />
        <Button
          label="Start run"
          icon="run-fast"
          variant="run"
          style={styles.flex}
          disabled={sessionActive}
          onPress={() => startActivity('run')}
          accessibilityHint="Opens the tracker and starts recording a run"
        />
      </View>

      {error ? <Banner tone="error" title="Could not load your statistics" message={error} /> : null}
      {!data && loading ? <LoadingState /> : null}

      {data ? (
        <>
          <View style={styles.bento}>
            <GoalTile data={data} />
            <View style={styles.row}>
              <StreakTile data={data} />
              <WeekTile week={data.week} todayStart={data.todayStartMs} />
            </View>
            <MonthTile data={data} />
            <LifetimeTile data={data} />
          </View>

          <View style={styles.section}>
            <SectionHeader title="Recent" actionLabel={data.recent.length > 0 ? 'See all' : undefined} onAction={() => router.navigate('/history')} />
            {data.recent.length === 0 ? (
              <Card>
                <EmptyState
                  icon="map-marker-path"
                  title="No activities yet"
                  message="Start a walk or run above. Your route, distance and pace are saved on this phone."
                />
              </Card>
            ) : (
              <View style={styles.list}>
                {data.recent.map((activity) => (
                  <ActivityCard key={activity.id} activity={activity} onPress={() => router.push(`/activity/${activity.id}`)} />
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <SectionHeader title="Records & stickers" actionLabel="View all" onAction={() => router.push('/goals')} />
            <RecordChips data={data} />
            <Stickers data={data} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

/** Wordmark and an honest GPS chip: GPS only runs during a workout. */
function TopBar() {
  const theme = useTheme();
  const tracking = useTrackingSnapshot();
  const recording = tracking.activityId !== null && (tracking.phase === 'recording' || tracking.phase === 'paused');
  const accuracy = tracking.lastFix?.accuracyMeters ?? null;
  const gps = !recording
    ? { label: 'GPS idle', color: theme.textMuted, spoken: 'GPS is off until you start a workout' }
    : tracking.signalLost
      ? { label: 'GPS lost', color: theme.danger, spoken: 'GPS signal lost' }
      : accuracy !== null
        ? { label: `${formatAccuracy(accuracy)} GPS`, color: theme.success, spoken: `GPS accurate to ${formatAccuracy(accuracy)}` }
        : { label: 'GPS…', color: theme.textMuted, spoken: 'Waiting for GPS' };
  return (
    <View style={[styles.topBar, { borderBottomColor: theme.border }]}>
      <View style={styles.brand}>
        <Icon name="shield-outline" size={22} color={theme.accent} />
        <AppText variant="heading" weight="600" style={styles.wordmark}>
          STRIDE
        </AppText>
      </View>
      <View style={[styles.chip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]} accessible accessibilityLabel={gps.spoken}>
        <View style={[styles.dot, { backgroundColor: gps.color }, recording ? glow(gps.color, theme.scheme, 0.7) : null]} />
        <AppText variant="mono" color="textMuted">
          {gps.label}
        </AppText>
        <Icon name="access-point" size={16} color={theme.textMuted} />
      </View>
    </View>
  );
}

function PrivacyChip() {
  const theme = useTheme();
  return (
    <View
      style={[styles.chip, styles.privacyChip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
      accessible
      accessibilityLabel="Your data stays on this phone">
      <Icon name="lock" size={14} color={theme.accent} />
      <AppText variant="label" color="textSecondary" style={styles.privacyLabel} numberOfLines={1}>
        ON THIS PHONE ONLY
      </AppText>
    </View>
  );
}

function TileLabel({ children }: { children: string }) {
  return (
    <AppText variant="label" color="textMuted">
      {children}
    </AppText>
  );
}

function Value({ value, unit, size = 'metric' }: { value: string; unit: string; size?: 'large' | 'metric' | 'small' }) {
  return (
    <View style={styles.baseline}>
      <AppText
        variant={size === 'small' ? 'heading' : 'metric'}
        weight={size === 'small' ? '600' : '700'}
        style={size === 'large' ? styles.largeValue : undefined}
        numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant={size === 'small' ? 'caption' : 'body'} weight="500" color={size === 'small' ? 'textSecondary' : 'textMuted'}>
        {unit}
      </AppText>
    </View>
  );
}

function GoalTile({ data }: { data: DashboardData }) {
  const theme = useTheme();
  const goal = data.goal;
  const walk = data.today.walkDistanceMeters;
  const run = data.today.runDistanceMeters;
  return (
    <Card>
      <View style={styles.tileHeader}>
        <TileLabel>DAILY GOAL</TileLabel>
        <Pressable onPress={() => router.push('/goals')} hitSlop={12} accessibilityRole="button" accessibilityLabel={goal ? 'Edit daily goal' : 'Set a daily goal'}>
          <AppText variant="caption" weight="500" color="textSecondary">
            {goal ? 'Edit' : 'Set goal'}
          </AppText>
        </Pressable>
      </View>
      {goal ? (
        <View style={styles.goalBody}>
          <GoalRing progress={goal} walkMeters={walk} />
          <View style={styles.goalStats}>
            <Value value={formatKilometers(goal.achievedMeters)} unit={`/ ${trimKm(goal.targetMeters)} km`} size="large" />
            <View style={styles.inline}>
              <View style={[styles.dot, { backgroundColor: theme.primary }]} />
              <AppText variant="caption" color="textSecondary">
                {goal.completed ? 'Goal reached today' : `${formatDistance(goal.remainingMeters)} to go today`}
              </AppText>
            </View>
            <View style={[styles.split, { borderTopColor: theme.border }]}>
              <Legend color={theme.walk} label={`Walk ${shortDistance(walk)}`} active={walk > 0} />
              <Legend color={theme.run} label={`Run ${shortDistance(run)}`} active={run > 0} />
            </View>
          </View>
        </View>
      ) : (
        <AppText color="textSecondary">No daily goal yet. Set one to see today&apos;s progress ring here.</AppText>
      )}
    </Card>
  );
}

function Legend({ color, label, active }: { color: string; label: string; active: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.inline}>
      <View style={[styles.smallDot, { backgroundColor: active ? color : withAlpha(color, 0.4) }]} />
      <AppText variant="caption" tint={active ? color : theme.textMuted} style={styles.legend}>
        {label}
      </AppText>
    </View>
  );
}

function StreakTile({ data }: { data: DashboardData }) {
  const theme = useTheme();
  const { current, longest, activeToday } = data.streaks;
  return (
    <Card style={[styles.tile, styles.flex]}>
      <View style={styles.tileHeader}>
        <TileLabel>STREAK</TileLabel>
        <Icon name="fire" size={20} color={theme.run} />
      </View>
      <Value value={String(current)} unit={current === 1 ? 'day' : 'days'} size="large" />
      <AppText variant="caption" color="textSecondary">
        {activeToday || current === 0 ? (
          <>
            Longest{' '}
            <AppText variant="caption" weight="600">
              {longest}
            </AppText>
          </>
        ) : (
          'Be active today to keep it going'
        )}
      </AppText>
    </Card>
  );
}

function WeekTile({ week, todayStart }: { week: ComparedPeriod; todayStart: number }) {
  const theme = useTheme();
  const busiest = Math.max(1, ...week.days.map((day) => day.totalMeters));
  const change = week.distanceChange;
  const spoken = `This week ${formatDistance(week.current.totalDistanceMeters, { alwaysKm: true })}${
    change !== null ? `, ${Math.round(Math.abs(change) * 100)}% ${change >= 0 ? 'more' : 'less'} than last week` : ''
  }`;
  return (
    <Card style={[styles.tile, styles.flex]}>
      <View accessible accessibilityLabel={spoken} style={styles.tileContent}>
        <View style={styles.tileHeader}>
          <TileLabel>THIS WEEK</TileLabel>
          {change !== null ? <DeltaChip change={change} /> : null}
        </View>
        <Value value={formatKilometers(week.current.totalDistanceMeters)} unit="km" />
        <View style={styles.bars}>
          {week.days.map((day) => {
            const today = day.startMs === todayStart;
            const future = day.startMs > todayStart;
            const height = future ? 0.12 : Math.max(0.12, day.totalMeters / busiest);
            return (
              <View
                key={day.dayKey}
                style={[
                  styles.bar,
                  {
                    height: `${Math.round(height * 100)}%`,
                    backgroundColor: today ? theme.primary : future ? withAlpha(theme.border, 0.6) : theme.surfaceAlt,
                  },
                  today ? glow(theme.primary, theme.scheme, 0.6) : null,
                ]}
              />
            );
          })}
        </View>
      </View>
    </Card>
  );
}

function DeltaChip({ change }: { change: number }) {
  const theme = useTheme();
  const percent = Math.round(Math.abs(change) * 100);
  const up = change > 0 && percent > 0;
  const down = change < 0 && percent > 0;
  return (
    <View
      style={[
        styles.delta,
        { backgroundColor: up ? theme.successSurface : theme.surfaceAlt, borderColor: up ? withAlpha(theme.accent, 0.3) : theme.border },
      ]}>
      <AppText variant="mono" weight="700" tint={up ? theme.accent : theme.textSecondary} style={styles.deltaText}>
        {up ? '▲ ' : down ? '▼ ' : ''}
        {percent}%
      </AppText>
    </View>
  );
}

function MonthTile({ data }: { data: DashboardData }) {
  const count = data.month.activityCount;
  return (
    <Card style={[styles.tile, styles.monthTile]}>
      <View style={styles.tileContent}>
        <TileLabel>THIS MONTH</TileLabel>
        <Value value={formatKilometers(data.month.totalDistanceMeters)} unit="km" />
      </View>
      <View style={styles.monthCount}>
        <AppText variant="heading" weight="600">
          {count}
        </AppText>
        <AppText variant="caption" color="textSecondary">
          {count === 1 ? 'activity' : 'activities'}
        </AppText>
      </View>
    </Card>
  );
}

/** Lifetime totals over a faint collage of the latest routes ("light painting"). */
function LifetimeTile({ data }: { data: DashboardData }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.collage} pointerEvents="none">
        {data.recent.map((activity) => (
          <View key={activity.id} style={StyleSheet.absoluteFill}>
            <RouteThumbnail
              lines={activity.routePreview}
              width={COLLAGE.width}
              height={COLLAGE.height}
              color={activity.type === 'run' ? theme.run : theme.walk}
              strokeWidth={2}
              endpoints={false}
              background={null}
            />
          </View>
        ))}
      </View>
      <TileLabel>LIFETIME ON DEVICE</TileLabel>
      <View style={styles.lifetimeRow}>
        <Value value={formatKilometers(data.records.lifetimeDistanceMeters)} unit="km" />
        <Separator />
        <Value value={String(data.totalActivities)} unit={data.totalActivities === 1 ? 'activity' : 'activities'} size="small" />
        <Separator />
        <Value value={activeTotal(data.records.lifetimeActiveSeconds)} unit="active" size="small" />
      </View>
    </Card>
  );
}

function Separator() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.border }]} />;
}

function RecordChips({ data }: { data: DashboardData }) {
  const theme = useTheme();
  const { records, streaks } = data;
  const chips: { icon: IconName; label: string; value: string; color: string }[] = [
    { icon: 'trophy', label: 'Longest', value: records.longestDistance ? formatDistance(records.longestDistance.value) : '—', color: theme.accent },
    { icon: 'lightning-bolt', label: 'Fastest', value: records.fastestPace ? `${formatPace(records.fastestPace.value)} /km` : '—', color: theme.run },
    { icon: 'timer-outline', label: 'Duration', value: records.longestDuration ? formatDurationShort(records.longestDuration.value) : '—', color: theme.walk },
    { icon: 'fire', label: 'Best streak', value: `${streaks.longest} ${streaks.longest === 1 ? 'day' : 'days'}`, color: theme.warning },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.chipRow}>
      {chips.map((chip) => (
        <View
          key={chip.label}
          style={[styles.recordChip, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
          accessible
          accessibilityLabel={`${chip.label} ${chip.value}`}>
          <Icon name={chip.icon} size={14} color={chip.color} />
          <AppText variant="caption" weight="500">
            {chip.label}{' '}
            <AppText variant="caption" weight="700" tint={chip.color}>
              {chip.value}
            </AppText>
          </AppText>
        </View>
      ))}
    </ScrollView>
  );
}

function Stickers({ data }: { data: DashboardData }) {
  if (data.achievements.length === 0) {
    return (
      <AppText variant="caption" color="textSecondary">
        Stickers appear here as you reach milestones.
      </AppText>
    );
  }
  return (
    <View style={styles.stickers}>
      {data.achievements
        .slice(-4)
        .reverse()
        .map((achievement, index) => (
          <HoloSticker
            key={achievement.type}
            icon={achievementIcon(achievement.type)}
            label={definitionFor(achievement.type)?.title ?? achievement.type}
            tilt={STICKER_TILTS[index % STICKER_TILTS.length]}
          />
        ))}
    </View>
  );
}

/** Whole hours once there are any ("98 h"), minutes before that. */
function activeTotal(seconds: number): string {
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)} h` : formatDurationShort(seconds);
}

/** "5" or "7.5", without the trailing zeros formatKilometers keeps for live readouts. */
function trimKm(meters: number): string {
  return String(Number((meters / 1000).toFixed(2)));
}

function shortDistance(meters: number): string {
  return meters > 0 ? formatDistance(meters) : '0 km';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screen,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  wordmark: { letterSpacing: 2.5 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  smallDot: { width: 6, height: 6, borderRadius: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  date: { fontSize: 14, lineHeight: 20 },
  privacyChip: { marginTop: 8, flexShrink: 1 },
  privacyLabel: { fontSize: 11, lineHeight: 14, letterSpacing: 0.8 },
  row: { flexDirection: 'row', gap: Spacing.md },
  bento: { gap: Spacing.md },
  tile: { padding: Spacing.lg, justifyContent: 'space-between' },
  tileContent: { gap: Spacing.sm },
  tileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, minHeight: 24 },
  baseline: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  largeValue: { fontSize: 44, lineHeight: 50, letterSpacing: -1.3 },
  goalBody: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  goalStats: { flex: 1, gap: Spacing.xs },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  split: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap', borderTopWidth: 1, paddingTop: Spacing.sm, marginTop: Spacing.sm },
  legend: { fontSize: 12, lineHeight: 16 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 32, marginTop: Spacing.xs },
  bar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  delta: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  deltaText: { fontSize: 11, lineHeight: 14 },
  monthTile: { flexDirection: 'row', alignItems: 'center' },
  monthCount: { marginLeft: 'auto', alignItems: 'flex-end' },
  collage: { position: 'absolute', right: -6, bottom: -14, width: COLLAGE.width, height: COLLAGE.height, opacity: 0.16 },
  lifetimeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Spacing.md, rowGap: Spacing.xs, marginTop: Spacing.xs },
  separator: { width: 4, height: 4, borderRadius: 2 },
  section: { gap: Spacing.md },
  list: { gap: 10 },
  bleed: { marginHorizontal: -Spacing.screen },
  chipRow: { gap: Spacing.sm, paddingHorizontal: Spacing.screen },
  recordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  stickers: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.xs },
});
