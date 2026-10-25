import { boundsOf, circleRing, destinationPoint, haversineDistanceMeters, isValidCoordinate } from '@/utils/geo';

describe('haversineDistanceMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineDistanceMeters({ latitude: 10, longitude: 20 }, { latitude: 10, longitude: 20 })).toBe(0);
  });

  it('matches one degree of latitude (~111.2 km on the mean-radius sphere)', () => {
    const d = haversineDistanceMeters({ latitude: 0, longitude: 0.5 }, { latitude: 1, longitude: 0.5 });
    expect(d).toBeCloseTo(111_195, -1);
  });

  it('matches a known city pair (London–Paris ≈ 343.5 km)', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    const paris = { latitude: 48.8566, longitude: 2.3522 };
    expect(haversineDistanceMeters(london, paris) / 1000).toBeCloseTo(343.5, 0);
  });

  it('is symmetric and handles the antimeridian', () => {
    const a = { latitude: 0, longitude: 179.9995 };
    const b = { latitude: 0, longitude: -179.9995 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(111.2, 0);
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 9);
  });

  it('round-trips with destinationPoint at walking scale', () => {
    const origin = { latitude: 40.7128, longitude: -74.006 };
    for (const meters of [1, 2.5, 10, 100, 1000]) {
      const target = destinationPoint(origin, meters, 37);
      expect(haversineDistanceMeters(origin, target)).toBeCloseTo(meters, 6);
    }
  });
});

describe('isValidCoordinate', () => {
  it.each([
    [{ latitude: 51.5, longitude: -0.12 }, true],
    [{ latitude: -90, longitude: 180 }, true],
    [{ latitude: 90.0001, longitude: 0.1 }, false],
    [{ latitude: 10, longitude: -180.5 }, false],
    [{ latitude: 0, longitude: 0 }, false],
    [{ latitude: Number.NaN, longitude: 1 }, false],
    [{ latitude: 1, longitude: Number.POSITIVE_INFINITY }, false],
    [null, false],
  ])('%j -> %s', (point, expected) => {
    expect(isValidCoordinate(point as never)).toBe(expected);
  });
});

describe('circleRing', () => {
  it('returns a closed ring whose points are all the given distance from the centre', () => {
    const centre = { latitude: 59.33, longitude: 18.06 };
    const ring = circleRing(centre, 25, 36);
    expect(ring).toHaveLength(37);
    expect(ring[36]).toEqual(ring[0]);
    for (const point of ring) expect(haversineDistanceMeters(centre, point)).toBeCloseTo(25, 6);
  });
});

describe('boundsOf', () => {
  it('returns null for an empty route and the extremes otherwise', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { latitude: 1, longitude: 5 },
        { latitude: -2, longitude: 7 },
        { latitude: 3, longitude: 6 },
      ]),
    ).toEqual({ minLatitude: -2, maxLatitude: 3, minLongitude: 5, maxLongitude: 7 });
  });
});
