import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import AndroidLocation, { parseDeviceStatus, parseStatus } from '@/modules/android-location';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Banner, LoadingState, SectionHeader } from '@/components/Feedback';
import { Screen } from '@/components/Screen';
import { Spacing } from '@/constants/theme';
import { checkDatabaseIntegrity } from '@/database/database';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations';
import { TRACKING_CONFIG } from '@/features/tracking/trackingConfig';
import { useDatabaseQuery } from '@/hooks/useDatabaseQuery';

/** Troubleshooting data. Shows thresholds and device state; no personal data leaves the phone. */
export default function DiagnosticsScreen() {
  const [integrity, setIntegrity] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const { data, error, loading, reload } = useDatabaseQuery(async (db) => {
    const counts = await db.getFirstAsync<{ activities: number; points: number; unfinished: number }>(
      `SELECT (SELECT COUNT(*) FROM activities WHERE status = 'completed') AS activities,
              (SELECT COUNT(*) FROM route_points) AS points,
              (SELECT COUNT(*) FROM activities WHERE status != 'completed') AS unfinished`,
      [],
    );
    const native = AndroidLocation ? parseStatus(await AndroidLocation.getStatusAsync()) : null;
    const device = AndroidLocation ? parseDeviceStatus(await AndroidLocation.getDeviceStatusAsync()) : null;
    return { counts, native, device };
  }, []);

  const runIntegrityCheck = async () => {
    setChecking(true);
    try {
      setIntegrity(await checkDatabaseIntegrity());
    } catch (reason) {
      setIntegrity(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChecking(false);
    }
  };

  const filter = TRACKING_CONFIG.filter;
  return (
    <Screen topInset={false}>
      {error ? <Banner tone="error" title="Could not read diagnostics" message={error} /> : null}
      {!data && loading ? <LoadingState /> : null}

      <SectionHeader title="Database" />
      <Card>
        <Row label="Schema version" value={String(LATEST_SCHEMA_VERSION)} />
        <Row label="Completed activities" value={String(data?.counts?.activities ?? '…')} />
        <Row label="Stored GPS measurements" value={String(data?.counts?.points ?? '…')} />
        <Row label="Unfinished sessions" value={String(data?.counts?.unfinished ?? '…')} />
        {integrity ? <Row label="Integrity check" value={integrity} /> : null}
        <Button label="Run integrity check" variant="secondary" loading={checking} onPress={() => void runIntegrityCheck()} />
      </Card>

      <SectionHeader title="Tracking service" />
      <Card>
        {data?.native ? (
          <>
            <Row label="Session" value={data.native.hasSession ? `${data.native.state} (activity ${data.native.activityId})` : 'none'} />
            <Row label="Service running" value={data.native.serviceRunning ? 'yes' : 'no'} />
            <Row label="Location source" value={data.native.locationSource ?? '—'} />
            <Row label="Unprocessed fixes in journal" value={String(data.native.pendingJournalPoints ?? 0)} />
            {data.native.interruptionReason ? <Row label="Interruption" value={data.native.interruptionReason} /> : null}
          </>
        ) : (
          <AppText color="textSecondary">The native tracking module is not part of this build.</AppText>
        )}
        <Button label="Refresh" variant="secondary" onPress={reload} />
      </Card>

      {data?.device ? (
        <>
          <SectionHeader title="Device" />
          <Card>
            <Row label="Android API level" value={String(data.device.sdkInt)} />
            <Row label="Google Play services" value={data.device.playServicesAvailable ? 'available (fused provider)' : 'missing (raw GPS fallback)'} />
            <Row label="GPS provider" value={data.device.gpsProviderEnabled ? 'on' : 'off'} />
            <Row label="Network location" value={data.device.networkProviderEnabled ? 'on' : 'off'} />
            <Row label="Battery" value={data.device.batteryPercent !== null ? `${data.device.batteryPercent}%` : '—'} />
            <Row label="Battery saver" value={data.device.powerSaveMode ? `on (location mode ${data.device.locationPowerSaveMode})` : 'off'} />
            <Row label="Background location" value={data.device.hasBackgroundLocation ? 'granted' : 'not granted (not needed)'} />
          </Card>
        </>
      ) : null}

      <SectionHeader title="GPS filter thresholds" />
      <Card>
        <Row label="Requested interval" value={`${TRACKING_CONFIG.desiredIntervalMs} ms`} />
        <Row label="Start requires accuracy" value={`≤ ${TRACKING_CONFIG.startAccuracyMeters} m`} />
        <Row label="Reject fixes worse than" value={`${filter.poorAccuracyMeters} m`} />
        <Row label="Good / caution accuracy" value={`≤ ${filter.preferredAccuracyMeters} m / ≤ ${filter.cautionAccuracyMeters} m`} />
        <Row label="Movement threshold" value={`max(${filter.minMovementMeters} m, ${filter.movementAccuracyFactor} × accuracy)`} />
        <Row label="Stationary below" value={`${filter.stationarySpeedMps} m/s`} />
        <Row label="Stationary threshold" value={`${filter.stationaryAccuracyFactor} × combined accuracy, +${filter.stationaryConfirmations} fixes`} />
        <Row label="Implausible speed" value={`> ${filter.maxPlausibleSpeedMps} m/s`} />
        <Row label="GPS gap after" value={`${filter.gapThresholdSeconds} s (bridged up to ${filter.maxBridgeableGapSeconds} s)`} />
        <Row label="Signal-lost warning after" value={`${TRACKING_CONFIG.signalLostAfterSeconds} s`} />
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText color="textSecondary" style={styles.label}>
        {label}
      </AppText>
      <AppText weight="600" style={styles.value}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, minHeight: 28, alignItems: 'center' },
  label: { flex: 1 },
  value: { flexShrink: 1, textAlign: 'right' },
});
