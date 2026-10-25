/**
 * Geodesic helpers. All distances are in meters.
 *
 * Haversine on a spherical Earth (mean radius 6,371,008.8 m) is accurate to
 * roughly 0.3–0.5 % against the WGS-84 ellipsoid, which is far below the error
 * contributed by consumer GPS fixes at walking/running scales.
 */

export const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;

export type LatLng = {
  latitude: number;
  longitude: number;
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineDistanceMeters(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  // Clamp guards against floating point drift pushing `a` slightly above 1.
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_MEAN_RADIUS_METERS * c;
}

/**
 * A coordinate is usable when both parts are finite and in range. (0, 0) is
 * rejected because location stacks commonly emit it as an "unset" value and
 * nobody is walking in the Gulf of Guinea at exactly that point.
 */
export function isValidCoordinate(point: Partial<LatLng> | null | undefined): point is LatLng {
  if (!point) return false;
  const { latitude, longitude } = point;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/** Moves a point by a distance (m) along a bearing (deg). Used by tests and replay. */
export function destinationPoint(origin: LatLng, distanceMeters: number, bearingDegrees: number): LatLng {
  const angular = distanceMeters / EARTH_MEAN_RADIUS_METERS;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.latitude);
  const lon1 = toRadians(origin.longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: ((((lon2 * 180) / Math.PI + 540) % 360) - 180),
  };
}

/** Closed ring of points `radiusMeters` around `center`, e.g. to draw a GPS accuracy circle. */
export function circleRing(center: LatLng, radiusMeters: number, steps = 48): LatLng[] {
  const ring: LatLng[] = [];
  for (let i = 0; i < steps; i += 1) ring.push(destinationPoint(center, radiusMeters, (360 * i) / steps));
  ring.push(ring[0]);
  return ring;
}

/** Linear interpolation between two fixes; only for replaying a recorded segment. */
export function interpolate(from: LatLng, to: LatLng, fraction: number): LatLng {
  const t = Math.min(1, Math.max(0, fraction));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    longitude: from.longitude + (to.longitude - from.longitude) * t,
  };
}

export type Bounds = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
};

export function boundsOf(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  for (const point of points) {
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    minLongitude = Math.min(minLongitude, point.longitude);
    maxLongitude = Math.max(maxLongitude, point.longitude);
  }
  return { minLatitude, maxLatitude, minLongitude, maxLongitude };
}
