import type { QualityCounters, RejectionReason } from './gpsFilter';
import type { GpsFilterConfig } from './trackingConfig';

export type SignalLevel = 'searching' | 'good' | 'fair' | 'poor' | 'lost' | 'disabled';

/** Live signal label for the accuracy of the latest fix. */
export function signalLevelFor(
  accuracyMeters: number | null,
  config: GpsFilterConfig,
  options: { lost?: boolean; disabled?: boolean } = {},
): SignalLevel {
  if (options.disabled) return 'disabled';
  if (options.lost) return 'lost';
  if (accuracyMeters === null) return 'searching';
  if (accuracyMeters <= config.preferredAccuracyMeters) return 'good';
  if (accuracyMeters <= config.cautionAccuracyMeters) return 'fair';
  return 'poor';
}

export type GpsQualityRating = 'good' | 'fair' | 'poor' | 'unknown';

export type GpsQualitySummary = {
  rating: GpsQualityRating;
  measurements: number;
  accepted: number;
  rejected: number;
  rejectionCounts: Partial<Record<RejectionReason, number>>;
  /** Share of fixes with known accuracy at or below 10 m. */
  goodFixShare: number | null;
  /** Share of fixes with known accuracy at or below 20 m. */
  usableFixShare: number | null;
  accuracyBuckets: QualityCounters['accuracyBuckets'];
  gapCount: number;
  totalGapSeconds: number;
  longestGapSeconds: number;
  bridgedGapCount: number;
  bridgedDistanceMeters: number;
  unbridgedGapCount: number;
  relocations: number;
  mockLocations: number;
  notes: string[];
};

export function summarizeQuality(counters: QualityCounters): GpsQualitySummary {
  const buckets = counters.accuracyBuckets;
  const withAccuracy = buckets.upTo5 + buckets.upTo10 + buckets.upTo20 + buckets.upTo30 + buckets.over30;
  const goodFixShare = withAccuracy > 0 ? (buckets.upTo5 + buckets.upTo10) / withAccuracy : null;
  const usableFixShare = withAccuracy > 0 ? (buckets.upTo5 + buckets.upTo10 + buckets.upTo20) / withAccuracy : null;

  let rating: GpsQualityRating = 'unknown';
  if (goodFixShare !== null && usableFixShare !== null) {
    if (goodFixShare >= 0.8 && counters.unbridgedGapCount === 0 && counters.relocations === 0) rating = 'good';
    else if (usableFixShare >= 0.6) rating = 'fair';
    else rating = 'poor';
  }

  const notes: string[] = [];
  if (counters.measurements === 0) notes.push('No GPS fixes were recorded.');
  if (counters.bridgedGapCount > 0) {
    notes.push(
      `${counters.bridgedGapCount} short GPS gap(s); ${Math.round(counters.bridgedDistanceMeters)} m across them is the straight-line distance between the fixes on either side.`,
    );
  }
  if (counters.unbridgedGapCount > 0) {
    notes.push(
      `${counters.unbridgedGapCount} long GPS gap(s) (longest ${Math.round(counters.longestGapSeconds)} s). Distance covered during them is missing from the total.`,
    );
  }
  if (counters.relocations > 0) {
    notes.push(`${counters.relocations} position jump(s) were not counted as distance.`);
  }
  const jumps = counters.rejectionCounts.implausible_speed ?? 0;
  if (jumps > 0) notes.push(`${jumps} fix(es) implied an implausible speed and were ignored.`);
  if (counters.mockLocations > 0) notes.push(`${counters.mockLocations} fix(es) came from a mock location provider.`);
  if (rating === 'poor') notes.push('Accuracy was often worse than 20 m; distance may be less reliable.');

  return {
    rating,
    measurements: counters.measurements,
    accepted: counters.accepted,
    rejected: counters.rejected,
    rejectionCounts: { ...counters.rejectionCounts },
    goodFixShare,
    usableFixShare,
    accuracyBuckets: { ...buckets },
    gapCount: counters.gapCount,
    totalGapSeconds: counters.totalGapSeconds,
    longestGapSeconds: counters.longestGapSeconds,
    bridgedGapCount: counters.bridgedGapCount,
    bridgedDistanceMeters: counters.bridgedDistanceMeters,
    unbridgedGapCount: counters.unbridgedGapCount,
    relocations: counters.relocations,
    mockLocations: counters.mockLocations,
    notes,
  };
}

export function parseQualitySummary(json: string | null | undefined): GpsQualitySummary | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as GpsQualitySummary;
    return parsed && typeof parsed.rating === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export const REJECTION_LABELS: Record<RejectionReason, string> = {
  invalid_coordinates: 'Invalid coordinates',
  invalid_timestamp: 'Invalid timestamp',
  duplicate: 'Duplicate',
  out_of_order: 'Out of order',
  poor_accuracy: 'Poor accuracy',
  implausible_speed: 'Implausible speed (jump)',
  below_noise_threshold: 'Below noise threshold',
  stationary_drift: 'Stationary drift',
  unconfirmed_movement: 'Awaiting confirmation',
};
