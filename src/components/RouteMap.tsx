import { Camera, GeoJSONSource, Layer, Map, type CameraRef, type InitialViewState } from '@maplibre/maplibre-react-native';
import type { Feature, FeatureCollection, LineString, MultiLineString, Point, Polygon } from 'geojson';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LogBox, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { MAP_FOLLOW_ZOOM, MAP_STYLE_URLS } from '@/constants/map';
import { Radius, Spacing } from '@/constants/theme';
import type { RouteGeometry } from '@/features/activities/routeGeometry';
import { useTheme } from '@/hooks/use-theme';
import { boundsOf, circleRing, type LatLng } from '@/utils/geo';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { RouteThumbnail } from './RouteThumbnail';

export type MapPosition = LatLng & { accuracyMeters?: number | null };

type RouteMapProps = {
  geometry: RouteGeometry;
  /** Live position (tracking screen). */
  currentPosition?: MapPosition | null;
  /** Keep the camera on the current position until the user pans. */
  followCurrentPosition?: boolean;
  /** Fit the whole route once the map is ready (detail screen). */
  fitRouteOnReady?: boolean;
  showEndMarker?: boolean;
  /** Replay: moving marker and the part of the route already replayed. */
  replayPosition?: LatLng | null;
  replayTrail?: LatLng[] | null;
  routeColor?: string;
  height?: number;
  /** Drawn instead of the map when the map style cannot be loaded. */
  fallbackPreview?: [number, number][][] | null;
};

// MapLibre warns once per run when tile data contains a degenerate line, which it skips. The
// OpenFreeMap tiles trigger it even with none of this file's line layers on screen, so it is not
// actionable here; it only stays out of the dev-build warning toast (it is still logged).
LogBox.ignoreLogs(['Invalid geometry in line layer']);

const TILE_TIMEOUT_MS = 12_000;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const toLngLat = (point: LatLng): [number, number] => [point.longitude, point.latitude];

/**
 * Map of the recorded route, rendered with MapLibre and free OpenFreeMap tiles (no API key).
 * Geometry always comes from recorded fixes; nothing is snapped to roads or fetched from a
 * routing service. If the map style cannot load (e.g. first use while offline), an offline route
 * sketch is shown instead, so recording is never blocked by the map.
 */
export function RouteMap(props: RouteMapProps) {
  const [failed, setFailed] = useState(false);
  const fallback = <MapFallback {...props} reason="The map could not be loaded (no internet?). Your route is still recorded." />;
  if (failed) return fallback;
  return (
    <MapErrorBoundary fallback={fallback}>
      <LiveMap {...props} onStyleFailed={() => setFailed(true)} />
    </MapErrorBoundary>
  );
}

function LiveMap({
  geometry,
  currentPosition,
  followCurrentPosition = false,
  fitRouteOnReady = false,
  showEndMarker = false,
  replayPosition,
  replayTrail,
  routeColor,
  height,
  onStyleFailed,
}: RouteMapProps & { onStyleFailed: () => void }) {
  const theme = useTheme();
  const cameraRef = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [tilesSlow, setTilesSlow] = useState(false);
  const [following, setFollowing] = useState(followCurrentPosition);
  const centredOnce = useRef(false);
  const color = routeColor ?? theme.route;
  const allPoints = useMemo(() => geometry.lines.flat(), [geometry]);

  // Only the first render matters for the initial camera.
  const [initialViewState] = useState<InitialViewState>(() => {
    const anchor = currentPosition ?? geometry.start;
    return anchor ? { center: toLngLat(anchor), zoom: MAP_FOLLOW_ZOOM } : { zoom: 1 };
  });

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setTilesSlow(true), TILE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const fitRoute = useCallback(() => {
    const bounds = boundsOf(allPoints);
    if (!cameraRef.current || !bounds) return;
    if (allPoints.length === 1) {
      cameraRef.current.easeTo({ center: toLngLat(allPoints[0]), zoom: MAP_FOLLOW_ZOOM, duration: 400 });
      return;
    }
    cameraRef.current.fitBounds([bounds.minLongitude, bounds.minLatitude, bounds.maxLongitude, bounds.maxLatitude], {
      // Extra room on the right keeps the route clear of the map buttons.
      padding: { top: 48, right: 72, bottom: 48, left: 48 },
      duration: 500,
    });
  }, [allPoints]);

  // An overview: following would pull the camera back to the current position on the next fix.
  const showWholeRoute = useCallback(() => {
    setFollowing(false);
    fitRoute();
  }, [fitRoute]);

  const recenter = useCallback(() => {
    setFollowing(true);
    if (currentPosition && cameraRef.current) {
      cameraRef.current.easeTo({ center: toLngLat(currentPosition), zoom: MAP_FOLLOW_ZOOM, duration: 400 });
    }
  }, [currentPosition]);

  useEffect(() => {
    if (ready && fitRouteOnReady) fitRoute();
    // Fit once when the map becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready || !following || !currentPosition || !cameraRef.current) return;
    if (!centredOnce.current) {
      // First position (the map may have opened zoomed out): jump straight to street level.
      centredOnce.current = true;
      cameraRef.current.jumpTo({ center: toLngLat(currentPosition), zoom: MAP_FOLLOW_ZOOM });
      return;
    }
    // Gestures and "show whole route" end following, so the zoom can only differ here right after
    // recenter; passing it keeps this animation from cancelling recenter's zoom to street level.
    cameraRef.current.easeTo({ center: toLngLat(currentPosition), zoom: MAP_FOLLOW_ZOOM, duration: 500 });
  }, [ready, following, currentPosition]);

  const routeShape = useMemo<Feature<MultiLineString> | FeatureCollection>(() => {
    const lines = geometry.lines.filter((line) => line.length > 1);
    if (lines.length === 0) return EMPTY;
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines.map((line) => line.map(toLngLat)) } };
  }, [geometry]);

  const gapShape = useMemo<Feature<MultiLineString> | FeatureCollection>(() => {
    if (geometry.gapConnectors.length === 0) return EMPTY;
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiLineString', coordinates: geometry.gapConnectors.map((pair) => pair.map(toLngLat)) },
    };
  }, [geometry]);

  const trailShape = useMemo<Feature<LineString> | FeatureCollection>(() => {
    if (!replayTrail || replayTrail.length < 2) return EMPTY;
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: replayTrail.map(toLngLat) } };
  }, [replayTrail]);

  const accuracyShape = useMemo<Feature<Polygon> | FeatureCollection>(() => {
    if (!currentPosition?.accuracyMeters) return EMPTY;
    const ring = circleRing(currentPosition, currentPosition.accuracyMeters).map(toLngLat);
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
  }, [currentPosition]);

  const markerShape = useMemo<FeatureCollection<Point>>(() => {
    const features: Feature<Point>[] = [];
    const add = (point: LatLng | null | undefined, role: string) => {
      if (point) features.push({ type: 'Feature', properties: { role }, geometry: { type: 'Point', coordinates: toLngLat(point) } });
    };
    add(geometry.start, 'start');
    if (showEndMarker) add(geometry.end, 'end');
    add(currentPosition, 'position');
    add(replayPosition, 'replay');
    return { type: 'FeatureCollection', features };
  }, [geometry, showEndMarker, currentPosition, replayPosition]);

  return (
    <View style={[styles.container, height ? { height } : styles.flex, { backgroundColor: theme.surfaceAlt }]}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={theme.scheme === 'dark' ? MAP_STYLE_URLS.dark : MAP_STYLE_URLS.light}
        // TextureView behaves inside ScrollViews and rounded, clipped containers.
        androidView="texture"
        attribution
        attributionPosition={{ bottom: 6, left: 6 }}
        logo={false}
        compass
        compassPosition={{ top: 8, left: 8 }}
        touchPitch={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onDidFailLoadingMap={onStyleFailed}
        onRegionWillChange={(event) => {
          if (event.nativeEvent.userInteraction && following) setFollowing(false);
        }}
        accessibilityLabel="Map of the recorded route">
        <Camera ref={cameraRef} initialViewState={initialViewState} />
        <GeoJSONSource id="route" data={routeShape}>
          {/* The afterglow: a wide, blurred halo under the route line. */}
          <Layer
            type="line"
            id="route-glow"
            paint={{ 'line-color': color, 'line-width': 16, 'line-blur': 8, 'line-opacity': replayTrail ? 0.08 : 0.25 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
          <Layer
            type="line"
            id="route-line"
            paint={{ 'line-color': color, 'line-width': 6, 'line-opacity': replayTrail ? 0.4 : 1 }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="gaps" data={gapShape}>
          <Layer type="line" id="gap-line" paint={{ 'line-color': theme.routeGap, 'line-width': 3, 'line-dasharray': [2, 2] }} />
        </GeoJSONSource>
        <GeoJSONSource id="trail" data={trailShape}>
          <Layer type="line" id="trail-line" paint={{ 'line-color': color, 'line-width': 6 }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        </GeoJSONSource>
        <GeoJSONSource id="accuracy" data={accuracyShape}>
          <Layer type="fill" id="accuracy-fill" paint={{ 'fill-color': color, 'fill-opacity': 0.14 }} />
          <Layer type="line" id="accuracy-outline" paint={{ 'line-color': color, 'line-width': 1, 'line-opacity': 0.5 }} />
        </GeoJSONSource>
        <GeoJSONSource id="markers" data={markerShape}>
          <Layer
            type="circle"
            id="marker-glow"
            filter={['match', ['get', 'role'], ['position', 'replay'], true, false]}
            paint={{ 'circle-radius': 20, 'circle-color': color, 'circle-opacity': 0.3, 'circle-blur': 0.9 }}
          />
          {/* Start is a hollow ring, finish and the live position are solid dots. */}
          <Layer
            type="circle"
            id="marker-dots"
            paint={{
              'circle-radius': ['match', ['get', 'role'], 'position', 9, 'replay', 9, 'start', 6, 7],
              'circle-color': ['match', ['get', 'role'], 'start', theme.surface, color],
              'circle-stroke-color': ['match', ['get', 'role'], 'start', color, '#FFFFFF'],
              'circle-stroke-width': 3,
            }}
          />
        </GeoJSONSource>
      </Map>

      {!ready ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: theme.surfaceAlt }]} pointerEvents="none">
          <AppText color="textSecondary">{tilesSlow ? 'Map needs an internet connection…' : 'Loading map…'}</AppText>
        </View>
      ) : null}

      <View style={styles.controls}>
        {currentPosition && (!following || !followCurrentPosition) ? (
          <MapButton icon="crosshairs-gps" label="Center on my position" onPress={recenter} />
        ) : null}
        {allPoints.length > 0 ? <MapButton icon="fit-to-screen-outline" label="Show the whole route" onPress={showWholeRoute} /> : null}
      </View>
    </View>
  );
}

function MapButton({ icon, label, onPress }: { icon: 'crosshairs-gps' | 'fit-to-screen-outline'; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.mapButton, { backgroundColor: theme.glass, borderColor: theme.border }]}>
      <Icon name={icon} size={24} color={theme.text} />
    </Pressable>
  );
}

function MapFallback({ geometry, fallbackPreview, routeColor, height, replayPosition, reason }: RouteMapProps & { reason: string }) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const preview = useMemo<[number, number][][]>(
    () =>
      geometry.lines.some((line) => line.length > 1)
        ? geometry.lines.map((line) => line.map((point): [number, number] => [point.latitude, point.longitude]))
        : (fallbackPreview ?? []),
    [fallbackPreview, geometry],
  );
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height: measured } = event.nativeEvent.layout;
    setSize({ width, height: measured });
  };
  return (
    <View style={[styles.container, height ? { height } : styles.flex, { backgroundColor: theme.surfaceAlt }]}>
      <View style={[styles.fallbackNotice, { backgroundColor: theme.surface }]}>
        <AppText variant="caption" color="textSecondary">
          {reason}
        </AppText>
      </View>
      <View style={styles.flex} onLayout={onLayout}>
        {size.width > 0 && preview.some((line) => line.length > 1) ? (
          <RouteThumbnail
            lines={preview}
            width={size.width}
            height={size.height}
            color={routeColor ?? theme.route}
            strokeWidth={4}
            marker={replayPosition}
          />
        ) : null}
      </View>
    </View>
  );
}

class MapErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Map failed to render', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { borderRadius: Radius.xl, overflow: 'hidden', minHeight: 180 },
  overlay: { alignItems: 'center', justifyContent: 'center' },
  fallbackNotice: { margin: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.sm },
  controls: { position: 'absolute', right: Spacing.sm, top: Spacing.sm, gap: Spacing.sm },
  mapButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
