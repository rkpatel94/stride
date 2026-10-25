import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './Icon';

type RouteThumbnailProps = {
  /** Separate [lat, lon] lines; nothing is drawn between them (pauses, long GPS gaps). */
  lines: [number, number][][] | null;
  width: number;
  height: number;
  color: string;
  strokeWidth?: number;
  /** Optional moving marker (route replay). */
  marker?: { latitude: number; longitude: number } | null;
  /** "Light painting": a soft halo under the line, drawn on ink. */
  glow?: boolean;
  /** Circular frame (activity cards) instead of a rounded rectangle. */
  round?: boolean;
  /** Start ring and finish dot. */
  endpoints?: boolean;
  /** null draws no background (e.g. layered behind other content). */
  background?: string | null;
};

/**
 * Offline sketch of a route from its simplified preview (no map tiles needed). Uses a local
 * equirectangular projection scaled to fit the box while keeping the aspect ratio.
 */
export function RouteThumbnail({
  lines,
  width,
  height,
  color,
  strokeWidth = 3,
  marker,
  glow = false,
  round = false,
  endpoints = true,
  background,
}: RouteThumbnailProps) {
  const theme = useTheme();
  const fill = background === undefined ? (glow ? theme.background : theme.surfaceAlt) : background;
  const outline = fill !== null && (round || glow) ? { borderWidth: 1, borderColor: theme.border } : null;
  const frame = [round ? { borderRadius: Math.min(width, height) / 2 } : styles.box, { width, height, backgroundColor: fill ?? undefined }];
  const drawable = (lines ?? []).filter((line) => line.length > 1);
  if (drawable.length === 0) {
    return (
      <View style={[frame, styles.empty, outline]}>
        <Icon name="map-marker-path" size={Math.min(width, height) / 2.5} color={theme.textMuted} />
      </View>
    );
  }
  const all = drawable.flat();
  // A round frame loses its corners, so the route is fitted into the inscribed square.
  const inset = round ? Math.min(width, height) * 0.15 : 0;
  const padding = strokeWidth * (glow ? 3 : 2) + 2 + inset;
  const meanLatitude = all.reduce((sum, [lat]) => sum + lat, 0) / all.length;
  const lonScale = Math.cos((meanLatitude * Math.PI) / 180);
  const xs = all.map(([, lon]) => lon * lonScale);
  const ys = all.map(([lat]) => lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(Math.max(...xs) - minX, 1e-9);
  const spanY = Math.max(Math.max(...ys) - minY, 1e-9);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = ([lat, lon]: [number, number]) =>
    [offsetX + (lon * lonScale - minX) * scale, height - (offsetY + (lat - minY) * scale)] as const;
  const [startX, startY] = project(all[0]);
  const [endX, endY] = project(all[all.length - 1]);
  const markerPoint = marker ? project([marker.latitude, marker.longitude]) : null;
  const polylines = drawable.map((line) =>
    line
      .map(project)
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' '),
  );

  return (
    <View
      style={[frame, outline, styles.clip]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        {glow
          ? polylines.map((points, index) => (
              <Polyline
                key={`halo-${index}`}
                points={points}
                fill="none"
                stroke={color}
                strokeOpacity={0.22}
                strokeWidth={strokeWidth * 3.2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))
          : null}
        {polylines.map((points, index) => (
          <Polyline
            key={index}
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {endpoints ? (
          <>
            <Circle cx={startX} cy={startY} r={strokeWidth + 0.5} fill={fill ?? theme.background} stroke={color} strokeWidth={2} />
            <Circle cx={endX} cy={endY} r={strokeWidth + 1} fill={color} />
          </>
        ) : null}
        {markerPoint ? (
          <Circle cx={markerPoint[0]} cy={markerPoint[1]} r={strokeWidth + 4} fill={color} stroke="#FFFFFF" strokeWidth={3} />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: Radius.md },
  clip: { overflow: 'hidden' },
  empty: { alignItems: 'center', justifyContent: 'center' },
});
