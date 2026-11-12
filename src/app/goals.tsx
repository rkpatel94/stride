import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { showError } from '@/components/confirm';
import { Banner, LoadingState, SectionHeader } from '@/components/Feedback';
import { GoalProgressBar } from '@/components/GoalProgressBar';
import { HoloSticker } from '@/components/HoloSticker';
import { achievementIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Fonts, glow, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { listAchievements } from '@/database/achievementRepository';
import { listActivitySummaries } from '@/database/activityRepository';
import { listGoals } from '@/database/goalRepository';
import { getPreferences } from '@/database/preferencesRepository';
import { ACHIEVEMENTS } from '@/features/achievements/achievements';
import { setGoal, setGoalEnabled } from '@/features/goals/goalService';
import {
  GOAL_PERIOD_LABELS,
  GOAL_PERIODS,
  goalCompletions,
  goalForPeriod,
  goalProgress,
  periodRange,
  validateGoalKilometers,
  type Goal,
  type GoalPeriod,
  type GoalProgress,
} from '@/features/goals/goals';
import { summarizePeriod } from '@/features/statistics/statistics';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';
import { useTheme } from '@/hooks/use-theme';
import { addLocalDays, localDayKey, startOfLocalDay } from '@/utils/dates';
import { formatDate, formatShortDate } from '@/utils/format';

const HISTORY_DAYS = 28;

type PeriodGoal = {
  period: GoalPeriod;
  goal: Goal | null;
  /** The last target set, shown when the goal is turned back on. */
  latestTarget: number | null;
  progress: GoalProgress | null;
  walkMeters: number;
  startMs: number;
  completions: number;
};

const CAPTIONS: Record<GoalPeriod, (startMs: number) => string> = {
  daily: () => 'Changes apply from today. Past days keep the goal that was set at the time.',
  weekly: (startMs) => `Counts for this whole week (from ${formatShortDate(startMs)}). Past weeks keep the goal they had.`,
  monthly: () => 'Counts for this whole month. Past months keep the goal they had.',
};

const OFF_TEXT: Record<GoalPeriod, string> = {
  daily: 'Off. Turn it on to see your progress each day on the Home screen.',
  weekly: 'Off. Turn it on to aim for a distance each week.',
  monthly: 'Off. Turn it on to aim for a distance each month.',
};

export default function GoalsScreen() {
  const theme = useTheme();
  const { data, error, loading } = useDatabaseQuery(async (db) => {
    const [activities, goals, achievements, preferences] = await Promise.all([
      listActivitySummaries(db),
      listGoals(db),
      listAchievements(db),
      getPreferences(db),
    ]);
    const now = Date.now();
    const weekStartsOn = preferences.weekStartsOn;
    const periods: PeriodGoal[] = GOAL_PERIODS.map((period) => {
      const range = periodRange(period, now, weekStartsOn);
      const goal = goalForPeriod(goals, period, now, weekStartsOn);
      const summary = summarizePeriod(activities, range.startMs, range.endMs);
      return {
        period,
        goal,
        latestTarget: goals.filter((row) => row.periodType === period).pop()?.targetDistanceMeters ?? null,
        progress: goal ? goalProgress(goal.targetDistanceMeters, summary.totalDistanceMeters) : null,
        walkMeters: summary.walkDistanceMeters,
        startMs: range.startMs,
        completions: goalCompletions(activities, goals, period, weekStartsOn).length,
      };
    });
    const dailyCompletions = goalCompletions(activities, goals, 'daily', weekStartsOn);
    const todayStart = startOfLocalDay(now);
    return {
      todayKey: localDayKey(now),
      days: Array.from({ length: HISTORY_DAYS }, (_, index) => addLocalDays(todayStart, index - HISTORY_DAYS + 1)),
      periods,
      completionDays: new Set(dailyCompletions.map((completion) => localDayKey(completion.startMs))),
      achievements,
    };
  }, []);

  if (!data) {
    return <Screen topInset={false}>{loading ? <LoadingState /> : <Banner tone="error" title="Could not load goals" message={error ?? undefined} />}</Screen>;
  }

  const unlocked = new Map(data.achievements.map((achievement) => [achievement.type, achievement]));
  const { days, todayKey, periods } = data;
  const count = (period: GoalPeriod) => periods.find((entry) => entry.period === period)?.completions ?? 0;
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;

  return (
    <Screen topInset={false}>
      {periods.map((entry) => (
        <GoalEditor key={entry.period} entry={entry} />
      ))}

      <SectionHeader title="Last four weeks" />
      <Card>
        <View
          style={styles.calendar}
          accessibilityLabel={`Daily goal reached on ${days.filter((day) => data.completionDays.has(localDayKey(day))).length} of the last ${HISTORY_DAYS} days`}>
          {days.map((day) => {
            const completed = data.completionDays.has(localDayKey(day));
            return (
              <View
                key={day}
                style={[
                  styles.day,
                  { backgroundColor: completed ? theme.primary : theme.surfaceAlt, borderColor: localDayKey(day) === todayKey ? theme.text : 'transparent' },
                  completed ? glow(theme.primary, theme.scheme, 0.35) : null,
                ]}>
                <AppText variant="caption" weight={completed ? '700' : '400'} tint={completed ? theme.onPrimary : theme.textSecondary}>
                  {new Date(day).getDate()}
                </AppText>
              </View>
            );
          })}
        </View>
        <AppText color="textSecondary">
          Goals reached in total: {plural(count('daily'), 'day')}, {plural(count('weekly'), 'week')}, {plural(count('monthly'), 'month')}.
        </AppText>
      </Card>

      <SectionHeader title="Achievements" />
      {ACHIEVEMENTS.map((definition) => {
        const earned = unlocked.get(definition.type);
        return (
          <Card
            key={definition.type}
            onPress={earned?.activityId ? () => router.push(`/activity/${earned.activityId}`) : undefined}
            accessibilityLabel={`${definition.title}: ${earned ? `unlocked ${formatDate(earned.unlockedAt)}` : 'locked'}. ${definition.description}`}
            style={styles.achievement}>
            <HoloSticker icon={achievementIcon(definition.type)} size={48} locked={!earned} tilt={earned ? -3 : 0} />
            <View style={styles.flex}>
              <AppText variant="body" weight="700" color={earned ? 'text' : 'textSecondary'}>
                {definition.title}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                {definition.description}
              </AppText>
            </View>
            <AppText variant="caption" color={earned ? 'text' : 'textMuted'}>
              {earned ? formatShortDate(earned.unlockedAt) : 'Locked'}
            </AppText>
          </Card>
        );
      })}
    </Screen>
  );
}

function GoalEditor({ entry }: { entry: PeriodGoal }) {
  const theme = useTheme();
  const { period, goal, latestTarget, progress, walkMeters, startMs } = entry;
  const labels = GOAL_PERIOD_LABELS[period];
  // null = show the saved goal; a string = what the user is typing.
  const [draft, setDraft] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedTarget = goal?.targetDistanceMeters ?? latestTarget ?? null;
  const input = draft ?? (savedTarget ? String(Number((savedTarget / 1000).toFixed(2))) : '');

  const save = async () => {
    const result = validateGoalKilometers(input, period);
    if ('error' in result) {
      setInputError(result.error);
      return;
    }
    setInputError(null);
    setSaving(true);
    try {
      await setGoal(period, result.meters);
      setDraft(null);
    } catch (reason) {
      showError('Could not save the goal', reason);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <View style={styles.switchRow}>
        <AppText variant="heading" style={styles.flex}>
          {labels.title}
        </AppText>
        <Switch
          value={goal !== null}
          onValueChange={(enabled) => void setGoalEnabled(period, enabled).catch((reason: unknown) => showError('Could not update the goal', reason))}
          accessibilityLabel={`Track a ${period} goal`}
          trackColor={{ true: theme.primary, false: theme.border }}
          thumbColor={goal !== null ? theme.onPrimary : theme.textMuted}
        />
      </View>
      {goal ? (
        <>
          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              inputMode="decimal"
              accessibilityLabel={`${labels.title} in kilometers`}
              style={[styles.input, { color: theme.text, borderColor: inputError ? theme.danger : theme.border, backgroundColor: theme.surfaceAlt }]}
              maxLength={7}
              returnKeyType="done"
              onSubmitEditing={() => void save()}
            />
            <AppText variant="heading" color="textSecondary">
              km
            </AppText>
            <Button label="Save" onPress={() => void save()} loading={saving} style={styles.flex} />
          </View>
          {inputError ? <AppText tint={theme.danger}>{inputError}</AppText> : null}
          <AppText variant="caption" color="textMuted">
            {CAPTIONS[period](startMs)}
          </AppText>
          <AppText variant="label" color="textSecondary">
            {labels.current.toUpperCase()}
          </AppText>
          <GoalProgressBar progress={progress} walkMeters={walkMeters} label={`${labels.title} progress`} />
        </>
      ) : (
        <AppText color="textSecondary">{OFF_TEXT[period]}</AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: TouchTarget.min },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    width: 120,
    minHeight: TouchTarget.min,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    fontFamily: Fonts.number[700],
    fontSize: 22,
  },
  calendar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  day: { width: 38, height: 38, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  achievement: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
