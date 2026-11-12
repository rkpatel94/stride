import { haversineDistanceMeters, type LatLng } from '@/utils/geo';

import type { ActivityType } from './types';

/** The parts of a stored or live point needed to draw the route. */
export type RouteVertex = LatLng & {
  startsNewLine: boolean;
  gapBeforeSeconds: number | null;
  /** The walk/run part; a change starts a new line that continues from the previous point. */
  activityType?: ActivityType | null;
};

export type RouteGeometry = {
  /** Solid polylines made of consecutive accepted fixes. */
  lines: LatLng[][];
  /** The part each line was recorded in (same length as lines); null when unknown. */
  lineTypes: (ActivityType | null)[];
  /**
   * Short GPS gaps whose straight-line distance was counted: drawn dashed so it is visible that
   * no fixes exist between the two ends.
   */
  gapConnectors: [LatLng, LatLng][];
  start: LatLng | null;
  end: LatLng | null;
};

export function emptyGeometry(): RouteGeometry {
  return { lines: [], lineTypes: [], gapConnectors: [], start: null, end: null };
}

/**
 * Appends one accepted point. Returns a new geometry object (only the last line array is
 * copied) so React state updates stay cheap on long routes.
 */
export function appendVertex(geometry: RouteGeometry, vertex: RouteVertex): RouteGeometry {
  const point: LatLng = { latitude: vertex.latitude, longitude: vertex.longitude };
  const type = vertex.activityType ?? null;
  const lines = geometry.lines.slice();
  const lineTypes = geometry.lineTypes.slice();
  let gapConnectors = geometry.gapConnectors;
  const last = lines.length - 1;
  const lastLine = lines[last];
  const lastType = lineTypes[last] ?? null;

  if (!lastLine || vertex.startsNewLine) {
    lines.push([point]);
    lineTypes.push(type);
  } else if (vertex.gapBeforeSeconds !== null) {
    gapConnectors = [...gapConnectors, [lastLine[lastLine.length - 1], point]];
    lines.push([point]);
    lineTypes.push(type);
  } else if (switchesPart(lastType, type)) {
    lines.push([lastLine[lastLine.length - 1], point]);
    lineTypes.push(type);
  } else {
    lines[last] = [...lastLine, point];
    lineTypes[last] = lastType ?? type;
  }
  return { lines, lineTypes, gapConnectors, start: geometry.start ?? point, end: point };
}

export function buildRouteGeometry(vertices: RouteVertex[]): RouteGeometry {
  const lines: LatLng[][] = [];
  const lineTypes: (ActivityType | null)[] = [];
  const gapConnectors: [LatLng, LatLng][] = [];
  for (const vertex of vertices) {
    const point: LatLng = { latitude: vertex.latitude, longitude: vertex.longitude };
    const type = vertex.activityType ?? null;
    const last = lines.length - 1;
    const lastLine = lines[last];
    const lastType = lineTypes[last] ?? null;
    if (!lastLine || vertex.startsNewLine) {
      lines.push([point]);
      lineTypes.push(type);
    } else if (vertex.gapBeforeSeconds !== null) {
      gapConnectors.push([lastLine[lastLine.length - 1], point]);
      lines.push([point]);
      lineTypes.push(type);
    } else if (switchesPart(lastType, type)) {
      lines.push([lastLine[lastLine.length - 1], point]);
      lineTypes.push(type);
    } else {
      lastLine.push(point);
      lineTypes[last] = lastType ?? type;
    }
  }
  const flat = lines.flat();
  return { lines, lineTypes, gapConnectors, start: flat[0] ?? null, end: flat[flat.length - 1] ?? null };
}

/** A known part followed by the other one (points without a part never split a line). */
function switchesPart(previous: ActivityType | null, next: ActivityType | null): boolean {
  return previous !== null && next !== null && previous !== next;
}

/** True when the route has both walking and running lines. */
export function hasBothParts(geometry: RouteGeometry): boolean {
  return geometry.lineTypes.includes('walk') && geometry.lineTypes.includes('run');
}

/**
 * Douglas–Peucker simplification for small previews (history thumbnails). Never used for
 * distance — only for drawing.
 */
export function simplifyRoute(points: LatLng[], toleranceMeters: number): LatLng[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > toleranceMeters) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function perpendicularDistance(point: LatLng, lineStart: LatLng, lineEnd: LatLng): number {
  // Local equirectangular projection is accurate enough at route scale.
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = 111_320 * Math.cos((lineStart.latitude * Math.PI) / 180);
  const x = (point.longitude - lineStart.longitude) * metersPerDegreeLon;
  const y = (point.latitude - lineStart.latitude) * metersPerDegreeLat;
  const ex = (lineEnd.longitude - lineStart.longitude) * metersPerDegreeLon;
  const ey = (lineEnd.latitude - lineStart.latitude) * metersPerDegreeLat;
  const lengthSquared = ex * ex + ey * ey;
  if (lengthSquared === 0) return haversineDistanceMeters(point, lineStart);
  const t = Math.max(0, Math.min(1, (x * ex + y * ey) / lengthSquared));
  return Math.hypot(x - t * ex, y - t * ey);
}

export type RoutePreview = [number, number][][];

/**
 * Compact preview of a route as separate [lat, lon] lines (breaks at pauses and long gaps are
 * kept), at most about `maxPoints` points in total.
 */
export function buildRoutePreview(lines: LatLng[][], maxPoints = 80): RoutePreview {
  const drawable = lines.filter((line) => line.length > 1);
  const total = drawable.reduce((sum, line) => sum + line.length, 0);
  if (total === 0) return [];
  let tolerance = 3;
  let simplified = drawable.map((line) => simplifyRoute(line, tolerance));
  while (simplified.reduce((sum, line) => sum + line.length, 0) > maxPoints && tolerance < 5000) {
    tolerance *= 2;
    simplified = drawable.map((line) => simplifyRoute(line, tolerance));
  }
  return simplified.map((line) => line.map((point) => [Number(point.latitude.toFixed(6)), Number(point.longitude.toFixed(6))]));
}
