import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { confirm, showError } from '@/components/confirm';
import { Banner, EmptyState, LoadingState, SectionHeader } from '@/components/Feedback';
import { ACTIVITY_ICONS, Icon } from '@/components/Icon';
import { Metric } from '@/components/MetricCard';
import { RouteMap } from '@/components/RouteMap';
import { Screen } from '@/components/Screen';
import { Chips } from '@/components/SegmentedControl';
import { Radius, Spacing } from '@/constants/theme';
import { getActivity } from '@/database/activityRepository';
import { getRoutePoints } from '@/database/routePointRepository';
import { definitionFor } from '@/features/achievements/achievements';
import { changeActivityType, deleteCompletedActivity } from '@/features/activities/activityService';
import { buildReplayTimeline, frameAt, REPLAY_SPEEDS, type ReplaySpeed } from '@/features/activities/replay';
import { buildRouteGeometry } from '@/features/activities/routeGeometry';
import { ACTIVITY_LABELS } from '@/features/activities/types';
import { trackingEngine } from '@/features/tracking/engineInstance';
import { REJECTION_LABELS } from '@/features/tracking/gpsQuality';
import type { RejectionReason } from '@/features/tracking/gpsFilter';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';
import { useTheme } from '@/hooks/use-theme';
import { useTrackingSnapshot } from '@/hooks/useTracking';
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatKilometers,
  formatPace,
  formatPercent,
  formatSpeed,
  formatTime,
} from '@/utils/format';

const REPLAY_TICK_MS = 100;

export default function ActivityDetailScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; completed?: string }>();
  const activityId = Number(params.id);
  const tracking = useTrackingSnapshot();

  const { data, error, loading } = useDatabaseQuery(
    async (db) => {
      if (!Number.isInteger(activityId) || activityId <= 0) return null;
      const [activity, points] = await Promise.all([getActivity(db, activityId), getRoutePoints(db, activityId, { acceptedOnly: true })]);
      return activity ? { activity, points } : null;
    },
    [activityId],
  );

  const geometry = useMemo(() => buildRouteGeometry(data?.points ?? []), [data]);
  const timeline = useMemo(
    () =>
      buildReplayTimeline(
        (data?.points ?? []).map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          timeMs: point.elapsedRealtimeMs ?? point.recordedAt,
          segmentIndex: point.segmentIndex,
          startsNewLine: point.startsNewLine,
          gapBeforeSeconds: point.gapBeforeSeconds,
          segmentDistanceMeters: point.segmentDistanceMeters,
        })),
      ),
    [data],
  );

  const [replayTime, setReplayTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(10);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setReplayTime((current) => {
        const next = (current ?? 0) + (REPLAY_TICK_MS / 1000) * speed;
        if (next >= timeline.durationSeconds) {
          setPlaying(false);
          return timeline.durationSeconds;
        }
        return next;
      });
    }, REPLAY_TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, timeline.durationSeconds]);

  const frame = replayTime !== null ? frameAt(timeline, replayTime) : null;
  const trail = useMemo(() => {
    if (!frame) return null;
    const passed = timeline.keyframes.slice(0, frame.keyframeIndex + 1).map(({ latitude, longitude }) => ({ latitude, longitude }));
    return [...passed, { latitude: frame.latitude, longitude: frame.longitude }];
  }, [frame, timeline]);

  const togglePlay = useCallback(() => {
    if (timeline.keyframes.length < 2) return;
    if (!playing && (replayTime === null || replayTime >= timeline.durationSeconds)) setReplayTime(0);
    setPlaying((value) => !value);
  }, [playing, replayTime, timeline]);

  const restart = useCallback(() => {
    setReplayTime(0);
    setPlaying(true);
  }, []);

  const stopReplay = useCallback(() => {
    setPlaying(false);
    setReplayTime(null);
  }, []);

  const remove = useCallback(async () => {
    const ok = await confirm({
      title: 'Delete this activity?',
      message: 'Its route and statistics will be permanently removed from this phone. Totals, goals and achievements are recalculated.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteCompletedActivity(activityId);
      router.back();
    } catch (reason) {
      showError('Could not delete the activity', reason);
    }
  }, [activityId]);

  const switchType = useCallback(async () => {
    if (!data) return;
    const next = data.activity.type === 'run' ? 'walk' : 'run';
    const ok = await confirm({
      title: `Change to ${ACTIVITY_LABELS[next].toLowerCase()}?`,
      message: 'Only the activity type changes; the route and distance stay the same.',
      confirmLabel: 'Change',
    });
    if (!ok) return;
    changeActivityType(activityId, next).catch((reason: unknown) => showError('Could not change the type', reason));
  }, [activityId, data]);

  if (!data) {
    return (
      <Screen topInset={false}>
        {loading ? <LoadingState /> : null}
        {error ? <Banner tone="error" title="Could not load the activity" message={error} /> : null}
        {!loading && !error ? <EmptyState icon="map-marker-question-outline" title="Activity not found" message="It may have been deleted." /> : null}
      </Screen>
    );
  }

  const { activity } = data;
  const accent = activity.type === 'run' ? theme.run : theme.walk;
  const quality = activity.gpsQualitySummary;
  const justCompleted = params.completed === '1' && tracking.lastCompleted?.activityId === activity.id ? tracking.lastCompleted : null;
  const inProgress = activity.status !== 'completed';

  return (
    <>
      <Stack.Screen options={{ title: `${ACTIVITY_LABELS[activity.type]} · ${formatDate(activity.startedAt)}` }} />
      <Screen topInset={false}>
        {justCompleted ? <CompletionCard info={justCompleted} distanceMeters={activity.distanceMeters} onDismiss={() => trackingEngine.clearLastCompleted()} /> : null}
        {inProgress ? <Banner tone="info" title="This workout is still in progress" message="Open the Track tab to continue or finish it." /> : null}

        <RouteMap
          geometry={geometry}
          fitRouteOnReady
          showEndMarker
          routeColor={accent}
          replayPosition={frame}
          replayTrail={trail}
          height={300}
          fallbackPreview={activity.routePreview}
        />

        <Card>
          <View style={styles.replayHeader}>
            <AppText variant="heading">Route replay</AppText>
            {frame ? (
              <AppText color="textSecondary">
                {formatDuration(frame.t)} · {formatDistance(frame.distanceMeters)}
              </AppText>
            ) : null}
          </View>
          {timeline.keyframes.length < 2 ? (
            <AppText color="textSecondary">Not enough recorded points to replay this route.</AppText>
          ) : (
            <>
              <ProgressBar progress={frame?.progress ?? 0} color={accent} />
              {frame?.inGap ? (
                <AppText variant="caption" tint={theme.warning}>
                  No GPS fixes were recorded here — the marker waits, then jumps.
                </AppText>
              ) : null}
              <View style={styles.replayControls}>
                <Button label={playing ? 'Pause' : replayTime !== null && replayTime > 0 ? 'Resume' : 'Play'} icon={playing ? 'pause' : 'play'} onPress={togglePlay} style={styles.flex} />
                <Button label="Restart" icon="restart" variant="secondary" onPress={restart} style={styles.flex} />
                {replayTime !== null ? <Button label="Stop" icon="stop" variant="secondary" onPress={stopReplay} style={styles.flex} /> : null}
              </View>
              <Chips
                accessibilityLabel="Replay speed"
                options={REPLAY_SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))}
                value={String(speed)}
                onChange={(value) => setSpeed(Number(value) as ReplaySpeed)}
              />
              <AppText variant="caption" color="textMuted">
                Replay follows the recorded fixes and their timestamps. Paused time is skipped.
              </AppText>
            </>
          )}
        </Card>

        <Card>
          <View style={styles.titleRow}>
            <Icon name={ACTIVITY_ICONS[activity.type]} size={22} color={accent} />
            <AppText variant="heading" tint={accent}>
              {ACTIVITY_LABELS[activity.type]}
            </AppText>
            <Pressable onPress={() => void switchType()} accessibilityRole="button" hitSlop={8} style={styles.changeType}>
              <AppText variant="label" tint={theme.accent}>
                Change type
              </AppText>
            </Pressable>
          </View>
          <Metric label="Distance" value={formatKilometers(activity.distanceMeters)} unit="km" size="large" accent={accent} />
          <View style={styles.grid}>
            <Metric label="Active time" value={formatDuration(activity.activeDurationSeconds)} style={styles.cell} />
            <Metric label="Elapsed time" value={formatDuration(activity.elapsedDurationSeconds)} style={styles.cell} />
          </View>
          <View style={styles.grid}>
            <Metric label="Avg pace" value={formatPace(activity.averagePaceSecondsPerKm)} unit="/km" style={styles.cell} />
            <Metric label="Avg speed" value={formatSpeed(activity.averageSpeedMps)} unit="km/h" style={styles.cell} />
          </View>
          <View style={styles.grid}>
            <Metric label="Started" value={formatTime(activity.startedAt)} caption={formatDate(activity.startedAt)} style={styles.cell} />
            <Metric
              label="Finished"
              value={activity.endedAt ? formatTime(activity.endedAt) : '--'}
              caption={activity.endedAt ? formatDate(activity.endedAt) : undefined}
              style={styles.cell}
            />
          </View>
        </Card>

        <SectionHeader title="GPS quality" />
        <Card>
          {quality ? (
            <>
              <View style={styles.titleRow}>
                <Icon
                  name={quality.rating === 'good' ? 'check-circle' : quality.rating === 'fair' ? 'alert-circle-outline' : 'alert-octagon-outline'}
                  size={22}
                  color={quality.rating === 'good' ? theme.success : quality.rating === 'fair' ? theme.warning : theme.danger}
                />
                <AppText variant="heading">
                  {quality.rating === 'good' ? 'Good signal' : quality.rating === 'fair' ? 'Fair signal' : quality.rating === 'poor' ? 'Poor signal' : 'Unknown'}
                </AppText>
              </View>
              <QualityRow label="Fixes recorded" value={String(quality.measurements)} />
              <QualityRow label="Used for distance" value={String(quality.accepted)} />
              <QualityRow label="Fixes within 10 m" value={formatPercent(quality.goodFixShare)} />
              <QualityRow label="GPS gaps" value={quality.gapCount > 0 ? `${quality.gapCount} (${Math.round(quality.totalGapSeconds)} s)` : 'None'} />
              {quality.notes.map((note) => (
                <AppText key={note} variant="body" color="textSecondary">
                  • {note}
                </AppText>
              ))}
              {Object.keys(quality.rejectionCounts).length > 0 ? (
                <AppText variant="caption" color="textMuted">
                  Filtered:{' '}
                  {Object.entries(quality.rejectionCounts)
                    .map(([reason, count]) => `${REJECTION_LABELS[reason as RejectionReason] ?? reason} ${count}`)
                    .join(' · ')}
                </AppText>
              ) : null}
            </>
          ) : (
            <AppText color="textSecondary">No GPS quality summary is available for this activity.</AppText>
          )}
        </Card>

        {!inProgress ? (
          <Button label="Delete activity" icon="delete-outline" variant="danger" onPress={() => void remove()} />
        ) : null}
      </Screen>
    </>
  );
}

function CompletionCard({
  info,
  distanceMeters,
  onDismiss,
}: {
  info: { unlockedAchievements: string[]; goalReached: boolean };
  distanceMeters: number;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.completion, { backgroundColor: theme.successSurface, borderColor: theme.success }]} accessibilityLiveRegion="polite">
      <View style={styles.titleRow}>
        <Icon name={info.goalReached ? 'party-popper' : 'check-circle'} size={26} color={theme.success} />
        <AppText variant="heading" style={styles.flex}>
          {info.goalReached ? 'Daily goal reached — nice work!' : `Saved · ${formatDistance(distanceMeters)}`}
        </AppText>
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12}>
          <Icon name="close" size={22} color={theme.textSecondary} />
        </Pressable>
      </View>
      {info.unlockedAchievements.map((type) => {
        const definition = definitionFor(type);
        return (
          <View key={type} style={styles.titleRow}>
            <Icon name="trophy-outline" size={20} color={theme.warning} />
            <AppText>
              <AppText weight="700">{definition?.title ?? type}</AppText> — {definition?.description}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.progressTrack, { backgroundColor: theme.surfaceAlt }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
      <View style={[styles.progressFill, { width: `${Math.round(progress * 1000) / 10}%`, backgroundColor: color }]} />
    </View>
  );
}

function QualityRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.qualityRow}>
      <AppText color="textSecondary">{label}</AppText>
      <AppText weight="600">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  replayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  replayControls: { flexDirection: 'row', gap: Spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  changeType: { marginLeft: 'auto', minHeight: 32, justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: Spacing.md },
  cell: { flex: 1 },
  completion: { borderRadius: Radius.lg, borderWidth: 1.5, padding: Spacing.lg, gap: Spacing.sm },
  progressTrack: { height: 8, borderRadius: Radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%' },
  qualityRow: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 28, alignItems: 'center' },
});
