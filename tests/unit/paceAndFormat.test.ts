import { formatDistance, formatDuration, formatKilometers, formatPace, formatRelativeDay, formatSpeed } from '@/utils/format';
import { averagePaceSecondsPerKm, averageSpeedMps, currentSpeedMps, paceFromSpeed } from '@/utils/pace';

describe('pace and speed', () => {
  it('computes average pace from total time and distance', () => {
    expect(averagePaceSecondsPerKm(1800, 5000)).toBe(360); // 30 min for 5 km = 6:00 /km
    expect(averageSpeedMps(5000, 1800)).toBeCloseTo(2.7778, 4);
  });

  it('returns null instead of dividing by zero or tiny distances', () => {
    expect(averagePaceSecondsPerKm(100, 0)).toBeNull();
    expect(averagePaceSecondsPerKm(100, 5)).toBeNull();
    expect(averagePaceSecondsPerKm(0, 1000)).toBeNull();
    expect(averageSpeedMps(100, 0)).toBeNull();
    expect(averagePaceSecondsPerKm(Number.NaN, 1000)).toBeNull();
  });

  it('does not report a pace when standing still', () => {
    expect(paceFromSpeed(0)).toBeNull();
    expect(paceFromSpeed(0.2)).toBeNull();
    expect(paceFromSpeed(2.5)).toBe(400);
  });

  it('computes current speed over a trailing window and drops to 0 when stopped', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ({ timeMs: i * 1000, cumulativeDistanceMeters: i * 3 }));
    expect(currentSpeedMps(samples, 59_000, 20)).toBeCloseTo(3, 6);
    // 30 s after the last movement:
    expect(currentSpeedMps(samples, 89_000, 20)).toBe(0);
    // Standing for 10 s inside a 20 s window halves the speed.
    expect(currentSpeedMps(samples, 69_000, 20)).toBeCloseTo(1.5, 6);
    expect(currentSpeedMps([], 1000, 20)).toBeNull();
    expect(currentSpeedMps(samples.slice(0, 2), 1000, 20)).toBeNull();
  });
});

describe('formatting', () => {
  it('shows meters below 1 km and kilometers above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(842.4)).toBe('842 m');
    expect(formatDistance(1000)).toBe('1.00 km');
    expect(formatDistance(12345)).toBe('12.3 km');
    expect(formatDistance(123456)).toBe('123 km');
    expect(formatDistance(500, { alwaysKm: true })).toBe('0.50 km');
    expect(formatDistance(null)).toBe('--');
    expect(formatKilometers(-5)).toBe('0.00');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('0:00');
  });

  it('formats pace and speed', () => {
    expect(formatPace(332)).toBe('5:32');
    expect(formatPace(359.6)).toBe('6:00');
    expect(formatPace(null)).toBe('--:--');
    expect(formatPace(4000)).toBe('--:--');
    expect(formatSpeed(2.5)).toBe('9.0');
  });
});

describe('formatRelativeDay', () => {
  const now = new Date(2026, 9, 24, 15, 30).getTime(); // Saturday, 24 October 2026, local time

  it('names today and yesterday regardless of the time of day', () => {
    expect(formatRelativeDay(new Date(2026, 9, 24, 0, 5).getTime(), now)).toBe('Today');
    expect(formatRelativeDay(new Date(2026, 9, 23, 23, 59).getTime(), now)).toBe('Yesterday');
  });

  it('uses the weekday within the past week and a short date before that', () => {
    const thursday = new Date(2026, 9, 22, 12, 30).getTime();
    expect(formatRelativeDay(thursday, now)).toBe(new Date(thursday).toLocaleDateString(undefined, { weekday: 'short' }));
    const older = new Date(2026, 9, 17, 9, 0).getTime();
    expect(formatRelativeDay(older, now)).toBe(new Date(older).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  });
});
