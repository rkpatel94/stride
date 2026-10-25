import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/ActivityCard';
import { confirm, showError } from '@/components/confirm';
import { AppText } from '@/components/AppText';
import { Banner, EmptyState, LoadingState } from '@/components/Feedback';
import { useTabBarInset } from '@/components/FloatingTabBar';
import { Chips, SegmentedControl } from '@/components/SegmentedControl';
import { Spacing } from '@/constants/theme';
import { listActivities } from '@/database/activityRepository';
import { getPreferences } from '@/database/preferencesRepository';
import { deleteCompletedActivity } from '@/features/activities/activityService';
import type { Activity, ActivityType } from '@/features/activities/types';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';
import { useTheme } from '@/hooks/use-theme';
import { addLocalDays, addLocalMonths, startOfLocalDay, startOfLocalMonth, startOfLocalWeek, type WeekStart } from '@/utils/dates';
import { formatDate, formatDistance } from '@/utils/format';

type TypeFilter = 'all' | ActivityType;
type DateFilter = 'all' | 'week' | 'month' | 'last30' | 'year';

function rangeFor(filter: DateFilter, now: number, weekStartsOn: WeekStart): { fromMs: number | null; toMs: number | null } {
  switch (filter) {
    case 'week': {
      const start = startOfLocalWeek(now, weekStartsOn);
      return { fromMs: start, toMs: addLocalDays(start, 7) };
    }
    case 'month': {
      const start = startOfLocalMonth(now);
      return { fromMs: start, toMs: addLocalMonths(start, 1) };
    }
    case 'last30':
      return { fromMs: addLocalDays(startOfLocalDay(now), -29), toMs: addLocalDays(startOfLocalDay(now), 1) };
    case 'year': {
      const start = new Date(new Date(now).getFullYear(), 0, 1).getTime();
      return { fromMs: start, toMs: new Date(new Date(now).getFullYear() + 1, 0, 1).getTime() };
    }
    default:
      return { fromMs: null, toMs: null };
  }
}

export default function HistoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const { data, error, loading } = useDatabaseQuery(
    async (db) => {
      const preferences = await getPreferences(db);
      const range = rangeFor(dateFilter, Date.now(), preferences.weekStartsOn);
      return listActivities(db, { type: typeFilter === 'all' ? null : typeFilter, ...range, limit: 1000 });
    },
    [typeFilter, dateFilter],
  );

  const remove = async (activity: Activity) => {
    const ok = await confirm({
      title: 'Delete this activity?',
      message: `${formatDistance(activity.distanceMeters)} on ${formatDate(activity.startedAt)} will be permanently removed. Totals, goals and achievements are recalculated.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteCompletedActivity(activity.id).catch((error: unknown) => showError('Could not delete the activity', error));
  };

  const totalDistance = useMemo(() => (data ?? []).reduce((sum, activity) => sum + activity.distanceMeters, 0), [data]);
  const filtered = typeFilter !== 'all' || dateFilter !== 'all';

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
      <AppText variant="title" accessibilityRole="header">
        History
      </AppText>
      <SegmentedControl
        accessibilityLabel="Activity type filter"
        options={[
          { value: 'all', label: 'All' },
          { value: 'walk', label: 'Walks' },
          { value: 'run', label: 'Runs' },
        ]}
        value={typeFilter}
        onChange={setTypeFilter}
      />
      <Chips
        accessibilityLabel="Date filter"
        options={[
          { value: 'all', label: 'All time' },
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'This month' },
          { value: 'last30', label: 'Last 30 days' },
          { value: 'year', label: 'This year' },
        ]}
        value={dateFilter}
        onChange={setDateFilter}
      />
      {data && data.length > 0 ? (
        <AppText color="textSecondary">
          {data.length} {data.length === 1 ? 'activity' : 'activities'} · {formatDistance(totalDistance, { alwaysKm: true })} · long
          press to delete
        </AppText>
      ) : null}
      {error ? <Banner tone="error" title="Could not load activities" message={error} /> : null}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.list, { paddingBottom: Spacing.xxl + tabBarInset }]}
      data={data ?? []}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <ActivityCard activity={item} onPress={() => router.push(`/activity/${item.id}`)} onLongPress={() => void remove(item)} />
      )}
      ListEmptyComponent={
        loading && !data ? (
          <LoadingState />
        ) : (
          <EmptyState
            icon={filtered ? 'filter-remove-outline' : 'map-marker-path'}
            title={filtered ? 'Nothing matches these filters' : 'No activities yet'}
            message={filtered ? 'Try a different type or date range.' : 'Completed walks and runs appear here with their route.'}
          />
        )
      }
      initialNumToRender={8}
      windowSize={7}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Spacing.screen },
  header: { gap: Spacing.md, paddingBottom: Spacing.lg },
  separator: { height: 10 },
});
