import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { showError } from '@/components/confirm';
import { SectionHeader } from '@/components/Feedback';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Spacing, TouchTarget } from '@/constants/theme';
import { getDatabase } from '@/database/database';
import { notifyDataChanged } from '@/database/dataEvents';
import { getPreferences, setPreference, type Preferences } from '@/database/preferencesRepository';
import { writeTransaction } from '@/database/writeQueue';
import { recomputeAchievements } from '@/features/achievements/achievementService';
import { exportBackupFile, importBackupFile } from '@/features/backup/backupFiles';
import {
  getDeviceStatus,
  getLocationAccess,
  needsNotificationPermission,
  openAppSettings,
  openBatteryOptimizationSettings,
  openNotificationSettings,
  requestLocationAccess,
  requestLocationServices,
  requestNotificationPermission,
  type LocationAccess,
} from '@/features/tracking/permissions';
import { useTheme } from '@/hooks/use-theme';
import type { DeviceLocationStatus } from '@/modules/android-location';

export default function SettingsScreen() {
  const theme = useTheme();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [device, setDevice] = useState<DeviceLocationStatus | null>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const refresh = useCallback(async () => {
    const db = await getDatabase();
    setPreferences(await getPreferences(db));
    setAccess(await getLocationAccess());
    setDevice(await getDeviceStatus());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const update = async <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    const db = await getDatabase();
    await writeTransaction(db, async () => {
      await setPreference(db, key, value);
      // Week boundaries affect weekly achievements.
      if (key === 'weekStartsOn') await recomputeAchievements(db);
    });
    notifyDataChanged();
    await refresh();
  };

  const exportData = async () => {
    setBusy('export');
    try {
      await exportBackupFile();
    } catch (error) {
      showError('Export failed', error);
    } finally {
      setBusy(null);
    }
  };

  const importData = async () => {
    setBusy('import');
    try {
      const result = await importBackupFile();
      if (result) {
        Alert.alert(
          'Import complete',
          `${result.imported} activities imported, ${result.skipped} already present${result.goals ? `, ${result.goals} goal settings added` : ''}.`,
        );
      }
    } catch (error) {
      showError('Import failed', error);
    } finally {
      setBusy(null);
    }
  };

  const version = Constants.expoConfig?.version ?? '?';

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        Settings
      </AppText>

      <SectionHeader title="Goals" />
      <Card onPress={() => router.push('/goals')} accessibilityLabel="Goals and achievements" style={styles.linkCard}>
        <Icon name="target" size={24} color={theme.accent} />
        <View style={styles.flex}>
          <AppText weight="600">Daily goal & achievements</AppText>
          <AppText variant="caption" color="textSecondary">
            Set your daily distance target and see milestones.
          </AppText>
        </View>
        <Icon name="chevron-right" size={24} color={theme.textMuted} />
      </Card>

      <SectionHeader title="Tracking" />
      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <AppText weight="600">Keep screen on while tracking</AppText>
            <AppText variant="caption" color="textSecondary">
              Not needed for recording — it continues with the screen locked. Uses more battery.
            </AppText>
          </View>
          <Switch
            value={preferences?.keepScreenOnWhileTracking ?? false}
            onValueChange={(value) => void update('keepScreenOnWhileTracking', value)}
            accessibilityLabel="Keep screen on while tracking"
            trackColor={{ true: theme.primary, false: theme.border }}
            thumbColor={preferences?.keepScreenOnWhileTracking ? theme.onPrimary : theme.textMuted}
          />
        </View>
        <AppText weight="600">Week starts on</AppText>
        <SegmentedControl
          accessibilityLabel="First day of the week"
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ]}
          value={String(preferences?.weekStartsOn ?? 1)}
          onChange={(value) => void update('weekStartsOn', Number(value) as 0 | 1)}
        />
      </Card>

      <SectionHeader title="Permissions & device" />
      <Card>
        <StatusRow
          icon="crosshairs-gps"
          label="Location permission"
          value={access === 'precise' ? 'Precise' : access === 'approximate' ? 'Approximate only' : access === null ? '…' : 'Not allowed'}
          ok={access === 'precise'}
          actionLabel={access === 'precise' ? undefined : access === 'denied' ? 'Allow' : 'Settings'}
          onAction={() => {
            if (access === 'denied') void requestLocationAccess().then(refresh);
            else void openAppSettings();
          }}
        />
        <StatusRow
          icon="map-marker-radius"
          label="Location services"
          value={device?.locationEnabled ? 'On' : 'Off'}
          ok={device?.locationEnabled === true}
          actionLabel={device?.locationEnabled ? undefined : 'Turn on'}
          onAction={() => void requestLocationServices().then(refresh)}
        />
        {needsNotificationPermission() ? (
          <StatusRow
            icon="bell-outline"
            label="Tracking notification"
            value={device?.notificationsEnabled ? 'Allowed' : 'Blocked'}
            ok={device?.notificationsEnabled === true}
            actionLabel={device?.notificationsEnabled ? undefined : 'Allow'}
            onAction={() => {
              void requestNotificationPermission().then(async (granted) => {
                if (granted) await refresh();
                else await openNotificationSettings();
              });
            }}
          />
        ) : null}
        <StatusRow
          icon="battery-heart-variant"
          label="Battery optimisation"
          value={device?.ignoringBatteryOptimizations ? 'Unrestricted' : 'Optimised'}
          ok={device?.ignoringBatteryOptimizations === true}
          actionLabel="Settings"
          onAction={() => void openBatteryOptimizationSettings()}
        />
        {device?.powerSaveMode ? (
          <AppText variant="caption" tint={theme.warning}>
            Battery saver is on. Android may limit GPS while the screen is off.
          </AppText>
        ) : null}
        <AppText variant="caption" color="textMuted">
          Stride only asks for location while in use. Recording keeps running with the screen locked because it runs as a
          foreground service with a visible notification. &quot;Allow all the time&quot; is not required.
        </AppText>
      </Card>

      <SectionHeader title="Your data" />
      <Card>
        <AppText color="textSecondary">
          All activities, routes, goals and achievements are stored only on this phone. There is no account, server or
          analytics. Uninstalling the app or clearing its storage deletes this data — export a backup to keep a copy.
        </AppText>
        <View style={styles.buttons}>
          <Button label="Export backup" icon="export-variant" variant="secondary" style={styles.flex} loading={busy === 'export'} disabled={busy !== null} onPress={() => void exportData()} />
          <Button label="Import backup" icon="import" variant="secondary" style={styles.flex} loading={busy === 'import'} disabled={busy !== null} onPress={() => void importData()} />
        </View>
      </Card>

      <SectionHeader title="Privacy" />
      <Card>
        <AppText color="textSecondary">
          Maps use free OpenFreeMap tiles (OpenStreetMap data), drawn on the phone by MapLibre. When a map is on
          screen, the tiles for that area are downloaded from OpenFreeMap&apos;s servers, which see the requested area and
          your IP address; no account or key is involved. Your recorded GPS track is never uploaded by Stride. GPS
          recording, history and statistics all work without an internet connection.
        </AppText>
      </Card>

      <SectionHeader title="About" />
      <Card onPress={() => router.push('/diagnostics')} accessibilityLabel="Diagnostics" style={styles.linkCard}>
        <Icon name="stethoscope" size={24} color={theme.accent} />
        <View style={styles.flex}>
          <AppText weight="600">Diagnostics</AppText>
          <AppText variant="caption" color="textSecondary">
            GPS thresholds, database check and device status.
          </AppText>
        </View>
        <Icon name="chevron-right" size={24} color={theme.textMuted} />
      </Card>
      <AppText variant="caption" color="textMuted" align="center">
        Stride {version} · personal walking & running tracker
      </AppText>
    </Screen>
  );
}

type StatusRowProps = {
  icon: IconName;
  label: string;
  value: string;
  ok: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

function StatusRow({ icon, label, value, ok, actionLabel, onAction }: StatusRowProps) {
  const theme = useTheme();
  return (
    <View style={styles.row} accessible={!actionLabel} accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={22} color={ok ? theme.success : theme.warning} />
      <View style={styles.flex}>
        <AppText weight="600">{label}</AppText>
        <AppText variant="caption" color="textSecondary">
          {value}
        </AppText>
      </View>
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" onPress={onAction} style={styles.rowButton} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: TouchTarget.min },
  rowButton: { minHeight: 40, paddingHorizontal: Spacing.md },
  buttons: { flexDirection: 'row', gap: Spacing.md },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});
