import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActivityCard } from '@/components/ActivityCard';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Banner, EmptyState, LoadingState } from '@/components/Feedback';
import { RouteMap, type OverviewRoute } from '@/components/RouteMap';
import { Screen } from '@/components/Screen';
import { Chips, SegmentedControl } from '@/components/SegmentedControl';
import { Spacing } from '@/constants/theme';
import { listActivities } from '@/database/activityRepository';
import { emptyGeometry } from '@/features/activities/routeGeometry';
import type { Activity } from '@/features/activities/types';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';
import { useTheme } from '@/hooks/use-theme';
import { addLocalDays, addLocalMonths, startOfLocalDay } from '@/utils/dates';
import { formatDistance } from '@/utils/format';

type TypeFilter = 'all' | 'walk' | 'run';
type RangeFilter = 'all' | 'year' | 'month';

const EMPTY_GEOMETRY = emptyGeometry();

function rangeStart(range: RangeFilter, now: number): number | null {
  if (range === 'month') return addLocalDays(startOfLocalDay(now), -30);
  if (range === 'year') return addLocalMonths(startOfLocalDay(now), -12);
  return null;
}

const hasRoute = (activity: Activity) => activity.routePreview?.some((line) => line.length > 1) === true;

/**
 * Every saved route on one map, from the compact previews stored with each workout (so it stays
 * quick with hundreds of routes). Tap a route to see which workout it was.
 */
export default function RoutesScreen() {
  const theme = useTheme();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [range, setRange] = useState<RangeFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, error, loading } = useDatabaseQuery(
    async (db) => ({ activities: await listActivities(db, { limit: 100_000 }), loadedAt: Date.now() }),
    [],
  );

  const visible = useMemo(() => {
    if (!data) return [];
    const from = rangeStart(range, data.loadedAt);
    return data.activities.filter(
      (activity) =>
        hasRoute(activity) && (typeFilter === 'all' || activity.type === typeFilter) && (from === null || activity.startedAt >= from),
    );
  }, [data, typeFilter, range]);

  const routes = useMemo<OverviewRoute[]>(
    () => visible.map((activity) => ({ id: activity.id, type: activity.type, lines: activity.routePreview ?? [] })),
    [visible],
  );
  const selected = visible.find((activity) => activity.id === selectedId) ?? null;
  const totalMeters = visible.reduce((sum, activity) => sum + activity.distanceMeters, 0);
  const anyRoutes = data?.activities.some(hasRoute) === true;

  if (!data) {
    return (
      <Screen topInset={false}>
        {loading ? <LoadingState /> : null}
        {error ? <Banner tone="error" title="Could not load your routes" message={error} /> : null}
      </Screen>
    );
  }

  if (!anyRoutes) {
    return (
      <Screen topInset={false}>
        <Card>
          <EmptyState icon="map-marker-path" title="No routes yet" message="Every walk and run you record shows up on this map." />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen topInset={false} scroll={false} contentStyle={styles.content}>
      <SegmentedControl
        accessibilityLabel="Activity type"
        options={[
          { value: 'all', label: 'All' },
          { value: 'walk', label: 'Walks' },
          { value: 'run', label: 'Runs' },
        ]}
        value={typeFilter}
        onChange={(value) => {
          setTypeFilter(value);
          setSelectedId(null);
        }}
      />
      <View style={styles.filterRow}>
        <Chips
          accessibilityLabel="Time range"
          options={[
            { value: 'all', label: 'All time' },
            { value: 'year', label: '12 months' },
            { value: 'month', label: '30 days' },
          ]}
          value={range}
          onChange={(value) => {
            setRange(value);
            setSelectedId(null);
          }}
        />
      </View>
      <AppText variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
        {visible.length === 1 ? '1 route' : `${visible.length} routes`} · {formatDistance(totalMeters, { alwaysKm: true })}
      </AppText>

      <View style={styles.map}>
        <RouteMap geometry={EMPTY_GEOMETRY} fitRouteOnReady routeColor={theme.route} overview={{ routes, selectedId, onSelect: setSelectedId }} />
      </View>

      {selected ? (
        <ActivityCard activity={selected} onPress={() => router.push(`/activity/${selected.id}`)} />
      ) : (
        <AppText variant="caption" color="textMuted" align="center">
          {visible.length > 0 ? 'Tap a route to see which workout it was.' : 'No routes match these filters.'}
        </AppText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.screen, gap: Spacing.md },
  filterRow: { flexDirection: 'row' },
  map: { flex: 1, minHeight: 260 },
});
