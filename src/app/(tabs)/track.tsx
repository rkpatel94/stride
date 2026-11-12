import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';

import AndroidLocation, { type DeviceLocationStatus } from '@/modules/android-location';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { confirm, showError } from '@/components/confirm';
import { Banner } from '@/components/Feedback';
import { GpsStatusBadge } from '@/components/GpsStatusBadge';
import { Metric } from '@/components/MetricCard';
import { RouteMap } from '@/components/RouteMap';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { glow, Radius, Spacing, withAlpha } from '@/constants/theme';
import { getDatabase } from '@/database/database';
import { getPreferences, setPreference, type Preferences } from '@/database/preferencesRepository';
import { serializeWrite } from '@/database/writeQueue';
import { emptyGeometry } from '@/features/activities/routeGeometry';
import type { ActivityType } from '@/features/activities/types';
import { trackingEngine } from '@/features/tracking/engineInstance';
import { signalLevelFor } from '@/features/tracking/gpsQuality';
import {
  describeInterruption,
  getDeviceStatus,
  getLocationAccess,
  openAppSettings,
  openBatteryOptimizationSettings,
  requestLocationAccess,
  requestLocationServices,
  requestNotificationPermission,
  type LocationAccess,
} from '@/features/tracking/permissions';
import { TRACKING_CONFIG } from '@/features/tracking/trackingConfig';
import { useTheme } from '@/hooks/use-theme';
import { useRouteRequest } from '@/hooks/useRouteRequest';
import { liveDurations, useLocationPreview, useTicker, useTrackingSnapshot } from '@/hooks/useTracking';
import { formatAccuracy, formatDistance, formatDuration, formatKilometers, formatPace, formatSpeed } from '@/utils/format';
import { averagePaceSecondsPerKm, averageSpeedMps, paceFromSpeed } from '@/utils/pace';

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();

type Preparing = { type: ActivityType; startedAt: number };

export default function TrackScreen() {
  const theme = useTheme();
  const focused = useIsFocused();
  const params = useLocalSearchParams<{ start?: string; confirmFinish?: string }>();
  const snapshot = useTrackingSnapshot();

  const [activityType, setActivityType] = useState<ActivityType>('walk');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [device, setDevice] = useState<DeviceLocationStatus | null>(null);
  const [preparing, setPreparing] = useState<Preparing | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Set while the activity type came from a start request (Home's buttons), so loading the
  // last-used type when the screen gains focus doesn't overwrite it. Cleared on blur.
  const typeFromRequest = useRef(false);

  const idle = snapshot.phase === 'idle';
  const sessionActive = snapshot.activityId !== null;
  const previewEnabled = focused && idle && access === 'precise' && device?.locationEnabled === true;
  const preview = useLocationPreview(previewEnabled);
  const now = useTicker(focused && (snapshot.phase === 'recording' || snapshot.phase === 'paused' || preparing !== null));

  const refreshDevice = useCallback(async () => {
    setAccess(await getLocationAccess());
    setDevice(await getDeviceStatus());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshDevice();
      void getDatabase()
        .then(getPreferences)
        .then((loaded) => {
          setPreferences(loaded);
          if (!sessionActive && !typeFromRequest.current) setActivityType(loaded.lastActivityType);
        });
      void trackingEngine.refreshStatus().catch(() => undefined);
      return () => {
        typeFromRequest.current = false;
      };
    }, [refreshDevice, sessionActive]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshDevice();
    });
    return () => subscription.remove();
  }, [refreshDevice]);

  // Keep the display on during a workout only if the user asked for it.
  const keepAwake = preferences?.keepScreenOnWhileTracking === true && (snapshot.phase === 'recording' || snapshot.phase === 'paused');
  useEffect(() => {
    if (!keepAwake) return;
    void activateKeepAwakeAsync('tracking').catch(() => undefined);
    return () => {
      void deactivateKeepAwake('tracking').catch(() => undefined);
    };
  }, [keepAwake]);

  // Guards against starting twice when several good fixes arrive while start() is in flight.
  const startingRef = useRef(false);
  const beginRecording = useCallback((type: ActivityType) => {
    if (startingRef.current) return;
    startingRef.current = true;
    trackingEngine
      .start(type)
      .then(
        () => setPreparing(null),
        (error: unknown) => {
          setPreparing(null);
          setMessage(error instanceof Error ? error.message : String(error));
        },
      )
      .finally(() => {
        startingRef.current = false;
      });
  }, []);

  /** Start workflow: permissions → location services → notifications → first good fix → record. */
  const startFlow = useCallback(
    async (type: ActivityType) => {
      setMessage(null);
      setActivityType(type);
      if (!AndroidLocation) {
        setMessage('GPS tracking needs the Stride development or release build; it is not available in Expo Go.');
        return;
      }
      let currentAccess = await getLocationAccess();
      if (currentAccess !== 'precise') currentAccess = await requestLocationAccess();
      setAccess(currentAccess);
      if (currentAccess === 'approximate') {
        setMessage('Precise location is off. Walking and running distance needs precise location — allow it in app settings.');
        return;
      }
      if (currentAccess !== 'precise') {
        setMessage('Location permission is needed to record your route.');
        return;
      }
      let status = await getDeviceStatus();
      if (status && !status.locationEnabled) {
        const enabled = await requestLocationServices();
        status = await getDeviceStatus();
        if (!enabled) {
          setDevice(status);
          setMessage('Turn on location to start recording.');
          return;
        }
      }
      setDevice(status);
      const db = await getDatabase();
      const prefs = await getPreferences(db);
      if (!prefs.notificationPermissionAsked) {
        await requestNotificationPermission();
        await serializeWrite(() => setPreference(db, 'notificationPermissionAsked', true));
      }
      setPreparing({ type, startedAt: monotonicNow() });
    },
    [],
  );

  // Once preparing, start as soon as a fresh, accurate enough fix is available.
  const previewFix = preview.fix;
  useEffect(() => {
    if (!preparing || !previewFix) return;
    const fresh = monotonicNow() - previewFix.receivedAt < TRACKING_CONFIG.maxFixAgeMs;
    if (fresh && previewFix.accuracyMeters !== null && previewFix.accuracyMeters <= TRACKING_CONFIG.startAccuracyMeters) {
      beginRecording(preparing.type);
    }
  }, [preparing, previewFix, beginRecording]);

  // Deep links: Home's start buttons and the notification's Finish action.
  useRouteRequest(params.start, (type) => {
    router.setParams({ start: undefined });
    if (type !== 'walk' && type !== 'run') return;
    typeFromRequest.current = true;
    // Run outside the effect body: the start flow updates screen state as it progresses.
    if (idle) queueMicrotask(() => void startFlow(type));
  });

  const finish = useCallback(async () => {
    const { activeSeconds } = liveDurations(trackingEngine.getSnapshot(), monotonicNow());
    const distance = trackingEngine.getSnapshot().distanceMeters;
    const tooShort = distance < 10 && activeSeconds < 30;
    const confirmed = await confirm({
      title: tooShort ? 'Save this very short workout?' : 'Finish and save?',
      message: tooShort
        ? 'Almost no distance was recorded. You can still save it, or discard it instead.'
        : `${formatDistance(distance)} in ${formatDuration(activeSeconds)} will be saved.`,
      confirmLabel: 'Finish',
    });
    if (!confirmed) return;
    try {
      const result = await trackingEngine.finish();
      router.push({ pathname: '/activity/[id]', params: { id: String(result.activityId), completed: '1' } });
    } catch (error) {
      showError('Could not save the workout', error);
    }
  }, []);

  const discard = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Discard this workout?',
      message: 'The recorded route, distance and time will be deleted. This cannot be undone.',
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await trackingEngine.discard();
    } catch (error) {
      showError('Could not discard the workout', error);
    }
  }, []);

  useRouteRequest(params.confirmFinish, () => {
    router.setParams({ confirmFinish: undefined });
    if (snapshot.activityId !== null && snapshot.phase !== 'finishing') queueMicrotask(() => void finish());
  });

  const run = (action: () => Promise<unknown>, title: string) => () => {
    action().catch((error: unknown) => showError(title, error));
  };

  // ---------------------------------------------------------------------------------------------

  if (snapshot.phase === 'initializing') {
    return (
      <Screen scroll={false} contentStyle={styles.centered}>
        <ActivityIndicator color={theme.accent} size="large" />
      </Screen>
    );
  }

  if (!sessionActive) {
    return (
      <IdleView
        activityType={activityType}
        onChangeType={setActivityType}
        access={access}
        device={device}
        preview={preview}
        preparing={preparing}
        now={now}
        message={message ?? snapshot.error}
        busy={snapshot.busy || snapshot.phase === 'starting'}
        onStart={() => void startFlow(activityType)}
        onRequestPermission={() => {
          void requestLocationAccess().then(() => refreshDevice());
        }}
        onStartAnyway={() => {
          if (preparing) beginRecording(preparing.type);
        }}
        onCancelPreparing={() => setPreparing(null)}
      />
    );
  }

  const durations = liveDurations(snapshot, now);
  const lastFixAge = snapshot.lastFixReceivedAt !== null ? now - snapshot.lastFixReceivedAt : null;
  const lost =
    snapshot.phase === 'recording' &&
    (snapshot.signalLost || (lastFixAge !== null && lastFixAge > TRACKING_CONFIG.signalLostAfterSeconds * 1000));
  const signal = signalLevelFor(snapshot.lastFix?.accuracyMeters ?? null, TRACKING_CONFIG.filter, {
    lost,
    disabled: !snapshot.locationServicesEnabled,
  });
  const currentSpeed = snapshot.phase === 'recording' ? trackingEngine.liveSpeedMps() : null;
  const accent = snapshot.activityType === 'run' ? theme.run : theme.walk;
  const position = snapshot.lastFix
    ? { latitude: snapshot.lastFix.latitude, longitude: snapshot.lastFix.longitude, accuracyMeters: snapshot.lastFix.accuracyMeters }
    : null;

  return (
    <Screen>
      <View style={styles.statusRow}>
        <StatePill phase={snapshot.phase} />
        <GpsStatusBadge level={signal} accuracyMeters={snapshot.lastFix?.accuracyMeters ?? null} />
      </View>

      {snapshot.phase === 'recovering' ? (
        <Banner
          tone="warning"
          title="Recording was interrupted"
          message={`${describeInterruption(snapshot.recovery?.reason ?? null)}${
            snapshot.recovery?.canResume ? ' Resuming starts a new route segment; nothing is drawn across the gap.' : ''
          }`}
        />
      ) : null}
      {!snapshot.locationServicesEnabled ? (
        <Banner
          tone="error"
          title="Location is turned off"
          message="Distance is not being recorded until location is back on."
          actionLabel="Turn on"
          onAction={() => void requestLocationServices()}
        />
      ) : null}
      {lost && snapshot.locationServicesEnabled ? (
        <Banner tone="warning" title="GPS signal lost" message="Distance resumes when the signal returns. The route may have a gap here." />
      ) : null}
      {snapshot.lowBattery ? <Banner tone="warning" title="Battery is low" message="Android may stop tracking if the phone shuts down." /> : null}
      {snapshot.error ? <Banner tone="error" title="Something went wrong" message={snapshot.error} /> : null}

      <View style={styles.mapBox}>
        <RouteMap geometry={snapshot.geometry} currentPosition={position} followCurrentPosition routeColor={accent} height={260} />
      </View>

      <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Metric label="Distance" value={formatKilometers(snapshot.distanceMeters)} unit="km" size="large" accent={accent} />
        <View style={styles.metricRow}>
          <Metric label="Active time" value={formatDuration(durations.activeSeconds)} style={styles.metricCell} />
          <Metric label="Elapsed" value={formatDuration(durations.elapsedSeconds)} style={styles.metricCell} />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Current pace" value={formatPace(paceFromSpeed(currentSpeed))} unit="/km" style={styles.metricCell} />
          <Metric
            label="Avg pace"
            value={formatPace(averagePaceSecondsPerKm(durations.activeSeconds, snapshot.distanceMeters))}
            unit="/km"
            style={styles.metricCell}
          />
        </View>
        <View style={styles.metricRow}>
          <Metric label="Speed" value={formatSpeed(currentSpeed)} unit="km/h" style={styles.metricCell} />
          <Metric
            label="Avg speed"
            value={formatSpeed(averageSpeedMps(snapshot.distanceMeters, durations.activeSeconds))}
            unit="km/h"
            style={styles.metricCell}
          />
        </View>
        <AppText variant="caption" color="textMuted">
          GPS {formatAccuracy(snapshot.lastFix?.accuracyMeters)} · {snapshot.acceptedPoints} points used, {snapshot.rejectedPoints} filtered
        </AppText>
      </View>

      <View style={styles.controls}>
        {snapshot.phase === 'recording' ? (
          <>
            <Button label="Pause" icon="pause" variant="secondary" size="large" style={styles.control} disabled={snapshot.busy} onPress={run(() => trackingEngine.pause(), 'Could not pause')} />
            <Button label="Finish" icon="flag-checkered" size="large" style={styles.control} disabled={snapshot.busy} onPress={() => void finish()} />
          </>
        ) : null}
        {snapshot.phase === 'paused' ? (
          <>
            <Button label="Resume" icon="play" size="large" style={styles.control} disabled={snapshot.busy} onPress={run(() => trackingEngine.resume(), 'Could not resume')} />
            <Button label="Finish" icon="flag-checkered" variant="secondary" size="large" style={styles.control} disabled={snapshot.busy} onPress={() => void finish()} />
          </>
        ) : null}
        {snapshot.phase === 'recovering' ? (
          <>
            {snapshot.recovery?.canResume !== false ? (
              <Button label="Resume" icon="play" size="large" style={styles.control} disabled={snapshot.busy} onPress={run(() => trackingEngine.resume(), 'Could not resume')} />
            ) : null}
            <Button label="Save" icon="content-save" variant="secondary" size="large" style={styles.control} disabled={snapshot.busy} onPress={() => void finish()} />
          </>
        ) : null}
        {snapshot.phase === 'finishing' ? (
          <View style={styles.saving}>
            <ActivityIndicator color={theme.accent} />
            <AppText>Saving your workout…</AppText>
          </View>
        ) : null}
      </View>
      {snapshot.phase === 'paused' || snapshot.phase === 'recovering' ? (
        <Button label="Discard workout" icon="delete-outline" variant="ghost" disabled={snapshot.busy} onPress={() => void discard()} />
      ) : null}
    </Screen>
  );
}

type IdleViewProps = {
  activityType: ActivityType;
  onChangeType: (type: ActivityType) => void;
  access: LocationAccess | null;
  device: DeviceLocationStatus | null;
  preview: ReturnType<typeof useLocationPreview>;
  preparing: Preparing | null;
  now: number;
  message: string | null;
  busy: boolean;
  onStart: () => void;
  onRequestPermission: () => void;
  onStartAnyway: () => void;
  onCancelPreparing: () => void;
};

function IdleView({
  activityType,
  onChangeType,
  access,
  device,
  preview,
  preparing,
  now,
  message,
  busy,
  onStart,
  onRequestPermission,
  onStartAnyway,
  onCancelPreparing,
}: IdleViewProps) {
  const theme = useTheme();
  const fix = preview.fix;
  const fresh = fix !== null && monotonicNow() - fix.receivedAt < TRACKING_CONFIG.maxFixAgeMs;
  const signal = signalLevelFor(fresh ? fix.accuracyMeters : null, TRACKING_CONFIG.filter, {
    disabled: device !== null && !device.locationEnabled,
  });
  const waitedSeconds = preparing ? (now - preparing.startedAt) / 1000 : 0;
  const timedOut = waitedSeconds > TRACKING_CONFIG.initialFixTimeoutSeconds;
  const batterySaverLimitsGps = device?.powerSaveMode === true && device.locationPowerSaveMode !== 0;

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        Track
      </AppText>
      <SegmentedControl
        accessibilityLabel="Activity type"
        options={[
          { value: 'walk', label: 'Walk' },
          { value: 'run', label: 'Run' },
        ]}
        value={activityType}
        onChange={onChangeType}
      />

      {!AndroidLocation ? (
        <Banner
          tone="error"
          title="Tracking module not available"
          message="This build does not include Stride's native GPS service (for example Expo Go). Install the development build described in the README."
        />
      ) : null}

      {access === 'denied' || access === 'blocked' || access === 'approximate' ? (
        <Banner
          tone="warning"
          title={access === 'approximate' ? 'Precise location is off' : 'Location permission needed'}
          message={
            access === 'approximate'
              ? 'With approximate location, positions can be off by hundreds of meters, so distance cannot be measured. Allow precise location for Stride.'
              : 'Stride records your route from GPS while a workout is active. Location is only used during a workout and stays on this phone.'
          }
          actionLabel={access === 'denied' ? 'Allow location' : 'Open settings'}
          onAction={() => {
            if (access === 'denied') onRequestPermission();
            else void openAppSettings();
          }}
        />
      ) : null}
      {device && !device.locationEnabled ? (
        <Banner
          tone="warning"
          title="Location is turned off"
          message="Turn on location services to record walks and runs."
          actionLabel="Turn on"
          onAction={() => void requestLocationServices()}
        />
      ) : null}
      {batterySaverLimitsGps ? (
        <Banner
          tone="warning"
          title="Battery saver may pause GPS"
          message="With battery saver on, Android can stop GPS while the screen is off. Turn it off for complete routes."
        />
      ) : null}
      {device && !device.ignoringBatteryOptimizations ? (
        <Banner
          tone="info"
          title="Improve background reliability"
          message="Some phones close apps in the background to save battery. Exempting Stride from battery optimisation helps long workouts record without gaps."
          actionLabel="Battery settings"
          onAction={() => void openBatteryOptimizationSettings()}
        />
      ) : null}
      {preview.error ? <Banner tone="error" title="Location unavailable" message={preview.error} /> : null}

      <View style={styles.statusRow}>
        <GpsStatusBadge level={signal} accuracyMeters={fresh ? fix.accuracyMeters : null} />
      </View>
      <RouteMap
        geometry={emptyGeometry()}
        currentPosition={fresh ? { latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: fix.accuracyMeters } : null}
        followCurrentPosition
        routeColor={activityType === 'run' ? theme.run : theme.walk}
        height={280}
      />

      {preparing ? (
        <View style={[styles.preparing, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.preparingRow}>
            <ActivityIndicator color={theme.accent} />
            <View style={styles.flex}>
              <AppText weight="700">Preparing — waiting for a precise GPS fix</AppText>
              <AppText color="textSecondary">
                {fresh && fix.accuracyMeters !== null
                  ? `Current accuracy ${formatAccuracy(fix.accuracyMeters)}; need ${formatAccuracy(TRACKING_CONFIG.startAccuracyMeters)} or better.`
                  : 'No position yet. Stand still outdoors with a clear view of the sky.'}
              </AppText>
            </View>
          </View>
          {timedOut ? (
            <AppText color="textSecondary">
              This is taking longer than usual. You can start anyway — distance is only counted once fixes are accurate enough.
            </AppText>
          ) : null}
          <View style={styles.controls}>
            <Button label="Cancel" variant="secondary" style={styles.control} onPress={onCancelPreparing} />
            <Button label="Start anyway" style={styles.control} disabled={!timedOut && waitedSeconds < 10} onPress={onStartAnyway} />
          </View>
        </View>
      ) : (
        <Button
          label={activityType === 'run' ? 'Start run' : 'Start walk'}
          icon={activityType === 'run' ? 'run-fast' : 'walk'}
          variant={activityType}
          size="large"
          loading={busy}
          onPress={onStart}
        />
      )}
      {message ? <Banner tone="error" title="Could not start" message={message} /> : null}
      <AppText variant="caption" color="textMuted" align="center">
        Recording continues with the screen locked. A notification shows while a workout is active.
      </AppText>
    </Screen>
  );
}

function StatePill({ phase }: { phase: string }) {
  const theme = useTheme();
  const config: Record<string, { label: string; color: string }> = {
    starting: { label: 'Preparing', color: theme.info },
    recording: { label: 'Recording', color: theme.success },
    paused: { label: 'Paused', color: theme.warning },
    recovering: { label: 'Recovering', color: theme.danger },
    finishing: { label: 'Saving', color: theme.info },
  };
  const { label, color } = config[phase] ?? { label: phase, color: theme.textSecondary };
  return (
    <View
      style={[styles.pill, { borderColor: withAlpha(color, 0.45), backgroundColor: theme.surfaceAlt }]}
      accessibilityLabel={`Tracking state: ${label}`}>
      <View style={[styles.dot, { backgroundColor: color }, phase === 'recording' ? glow(color, theme.scheme, 0.7) : null]} />
      <AppText variant="label" weight="700" tint={color}>
        {label.toUpperCase()}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.sm },
  mapBox: { height: 260 },
  panel: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.screen, gap: Spacing.lg },
  metricRow: { flexDirection: 'row', gap: Spacing.md },
  metricCell: { flex: 1 },
  controls: { flexDirection: 'row', gap: Spacing.md },
  control: { flex: 1 },
  saving: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 64 },
  preparing: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.screen, gap: Spacing.md },
  preparingRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
