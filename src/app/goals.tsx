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
import { ACHIEVEMENTS } from '@/features/achievements/achievements';
import { setDailyGoal, setDailyGoalEnabled } from '@/features/goals/goalService';
import { dailyGoalCompletions, goalInEffect, goalProgress, validateGoalKilometers } from '@/features/goals/goals';
import { todaySummary } from '@/features/statistics/statistics';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';
import { useTheme } from '@/hooks/use-theme';
import { addLocalDays, localDayKey, startOfLocalDay } from '@/utils/dates';
import { formatDate, formatShortDate } from '@/utils/format';

const HISTORY_DAYS = 28;

export default function GoalsScreen() {
  const theme = useTheme();
  const { data, error, loading } = useDatabaseQuery(async (db) => {
    const [activities, goals, achievements] = await Promise.all([listActivitySummaries(db), listGoals(db), listAchievements(db)]);
    const now = Date.now();
    const today = localDayKey(now);
    const current = goalInEffect(goals, today);
    const latestTarget = goals.filter((goal) => goal.periodType === 'daily').pop()?.targetDistanceMeters ?? null;
    const completions = dailyGoalCompletions(activities, goals);
    const todayStart = startOfLocalDay(now);
    return {
      todayKey: today,
      days: Array.from({ length: HISTORY_DAYS }, (_, index) => addLocalDays(todayStart, index - HISTORY_DAYS + 1)),
      current,
      latestTarget,
      progress: current ? goalProgress(current.targetDistanceMeters, todaySummary(activities, now).totalDistanceMeters) : null,
      walkToday: todaySummary(activities, now).walkDistanceMeters,
      completionDays: new Set(completions.map((completion) => completion.dayKey)),
      completionCount: completions.length,
      achievements,
    };
  }, []);

  // null = show the saved goal; a string = what the user is typing.
  const [draft, setDraft] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedTarget = data?.current?.targetDistanceMeters ?? data?.latestTarget ?? null;
  const input = draft ?? (savedTarget ? String(Number((savedTarget / 1000).toFixed(2))) : '');

  const save = async () => {
    const result = validateGoalKilometers(input);
    if ('error' in result) {
      setInputError(result.error);
      return;
    }
    setInputError(null);
    setSaving(true);
    try {
      await setDailyGoal(result.meters);
      setDraft(null);
    } catch (reason) {
      showError('Could not save the goal', reason);
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return <Screen topInset={false}>{loading ? <LoadingState /> : <Banner tone="error" title="Could not load goals" message={error ?? undefined} />}</Screen>;
  }

  const unlocked = new Map(data.achievements.map((achievement) => [achievement.type, achievement]));
  const { days, todayKey } = data;

  return (
    <Screen topInset={false}>
      <Card>
        <AppText variant="heading">Daily distance goal</AppText>
        <View style={styles.switchRow}>
          <AppText style={styles.flex}>Track a daily goal</AppText>
          <Switch
            value={data.current !== null}
            onValueChange={(enabled) => void setDailyGoalEnabled(enabled).catch((reason: unknown) => showError('Could not update the goal', reason))}
            accessibilityLabel="Track a daily goal"
            trackColor={{ true: theme.primary, false: theme.border }}
            thumbColor={data.current !== null ? theme.onPrimary : theme.textMuted}
          />
        </View>
        {data.current ? (
          <>
            <View style={styles.inputRow}>
              <TextInput
                value={input}
                onChangeText={setDraft}
                keyboardType="decimal-pad"
                inputMode="decimal"
                accessibilityLabel="Daily goal in kilometers"
                style={[styles.input, { color: theme.text, borderColor: inputError ? theme.danger : theme.border, backgroundColor: theme.surfaceAlt }]}
                maxLength={6}
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
              Changes apply from today. Past days keep the goal that was set at the time.
            </AppText>
            <GoalProgressBar progress={data.progress} walkMeters={data.walkToday} />
          </>
        ) : (
          <AppText color="textSecondary">Daily goals are off. Turn them on to see daily progress on the Home screen.</AppText>
        )}
      </Card>

      <SectionHeader title="Last four weeks" />
      <Card>
        <View style={styles.calendar} accessibilityLabel={`Goal reached on ${days.filter((day) => data.completionDays.has(localDayKey(day))).length} of the last ${HISTORY_DAYS} days`}>
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
          Goal reached on {data.completionCount} {data.completionCount === 1 ? 'day' : 'days'} in total.
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: TouchTarget.min },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    width: 110,
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
