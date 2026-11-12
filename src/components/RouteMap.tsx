import type { Feature, FeatureCollection, LineString, MultiLineString, Point, Polygon } from 'geojson';
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefAttributes,
} from 'react';
import { Linking, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  WebView as UntypedWebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
  type WebViewProps,
} from 'react-native-webview';

import { MAP_FOLLOW_ZOOM, MAP_STYLE_URLS } from '@/constants/map';
import { Radius, Spacing } from '@/constants/theme';
import { hasBothParts, type RouteGeometry } from '@/features/activities/routeGeometry';
import type { ActivityType } from '@/features/activities/types';
import { useTheme } from '@/hooks/use-theme';
import { boundsOf, circleRing, type LatLng } from '@/utils/geo';

import { AppText } from './AppText';
import { Icon } from './Icon';
import {
  buildMapPage,
  commandScript,
  MAP_PAGE_BASE_URL,
  parseMapPageMessage,
  type LngLat,
  type MapCommand,
} from './map/mapPage';
import { RouteThumbnail } from './RouteThumbnail';

export type MapPosition = LatLng & { accuracyMeters?: number | null };

/** One activity on the all-routes map: its preview lines as [lat, lon] pairs. */
export type OverviewRoute = { id: number; type: ActivityType; lines: [number, number][][] };

export type RouteOverview = {
  routes: OverviewRoute[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
};

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
  /** Many routes at once, tappable (the all-routes map). Fitted again whenever the list changes. */
  overview?: RouteOverview | null;
};

/** The WebView instance methods used here. */
type WebViewHandle = { injectJavaScript: (script: string) => void };
// react-native-webview declares `WebView<P = undefined>` with props `WebViewProps & P`, which
// TypeScript reduces to `never`. This restores the real props and the ref used here.
const WebView = UntypedWebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewHandle>>;

const TILE_TIMEOUT_MS = 12_000;
/** A WebView whose renderer was killed is recreated this many times before giving up. */
const MAX_RENDERER_RESTARTS = 2;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const toLngLat = (point: LatLng): LngLat => [point.longitude, point.latitude];
const pairToLngLat = ([latitude, longitude]: [number, number]): LngLat => [longitude, latitude];
/** Room around a fitted route; extra on the right keeps it clear of the map buttons. */
const FIT_PADDING = { top: 48, right: 72, bottom: 48, left: 48 };

/**
 * Map of the recorded route: MapLibre GL JS in a WebView with free OpenFreeMap tiles (no API key).
 * Geometry always comes from recorded fixes; nothing is snapped to roads or fetched from a routing
 * service. If the map cannot load (e.g. first use while offline), an offline route sketch is shown
 * instead, so recording is never blocked by the map.
 */
export function RouteMap(props: RouteMapProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const [restarts, setRestarts] = useState(0);
  const fallback = <MapFallback {...props} reason="The map could not be loaded (no internet?). Your route is still recorded." />;
  if (failed) return fallback;
  return (
    <MapErrorBoundary fallback={fallback}>
      <LiveMap
        // The page picks its style when it starts: a new colour scheme or a killed renderer needs a new page.
        key={`${theme.scheme}-${restarts}`}
        {...props}
        onStyleFailed={() => setFailed(true)}
        onRendererGone={() => {
          if (restarts < MAX_RENDERER_RESTARTS) setRestarts(restarts + 1);
          else setFailed(true);
        }}
      />
    </MapErrorBoundary>
  );
}

/** Links in the page (the map attribution) open in the browser instead of inside the map. */
function openLinksOutside(request: WebViewNavigation): boolean {
  if (request.url.startsWith(MAP_PAGE_BASE_URL) || request.url.startsWith('about:')) return true;
  if (/^https?:\/\//.test(request.url)) void Linking.openURL(request.url).catch(() => undefined);
  return false;
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
  overview,
  onStyleFailed,
  onRendererGone,
}: RouteMapProps & { onStyleFailed: () => void; onRendererGone: () => void }) {
  const theme = useTheme();
  const webViewRef = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [tilesSlow, setTilesSlow] = useState(false);
  const [following, setFollowing] = useState(followCurrentPosition);
  const centredOnce = useRef(false);
  const color = routeColor ?? theme.route;
  const replaying = Boolean(replayTrail);
  const overviewRoutes = overview?.routes ?? null;
  const selectedId = overview?.selectedId ?? null;
  // Which routes are shown; the camera re-fits when this changes, not on every data refresh.
  const overviewKey = overviewRoutes?.map((route) => route.id).join(',') ?? '';
  const allPoints = useMemo(() => {
    const points = geometry.lines.flat();
    for (const route of overviewRoutes ?? []) {
      for (const line of route.lines) for (const [latitude, longitude] of line) points.push({ latitude, longitude });
    }
    return points;
  }, [geometry, overviewRoutes]);

  // Only the first render matters for the style, the initial camera and the initial colours.
  const [page] = useState(() => {
    const anchor = currentPosition ?? geometry.start;
    // A map that shows a whole route opens already fitted to it: no zoom-in from the world view,
    // so far fewer tiles are requested and then cancelled while the map settles.
    const box = fitRouteOnReady ? boundsOf(allPoints) : null;
    return buildMapPage({
      styleUrl: theme.scheme === 'dark' ? MAP_STYLE_URLS.dark : MAP_STYLE_URLS.light,
      center: anchor ? toLngLat(anchor) : null,
      zoom: anchor ? MAP_FOLLOW_ZOOM : 1,
      bounds: box
        ? {
            box: [
              [box.minLongitude, box.minLatitude],
              [box.maxLongitude, box.maxLatitude],
            ],
            padding: FIT_PADDING,
            maxZoom: MAP_FOLLOW_ZOOM,
          }
        : undefined,
      background: theme.surfaceAlt,
      paint: { color, walkColor: theme.walk, runColor: theme.run, replay: replaying, gapColor: theme.routeGap, surfaceColor: theme.surface },
    });
  });

  const send = useCallback((command: MapCommand) => {
    webViewRef.current?.injectJavaScript(commandScript(command));
  }, []);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseMapPageMessage(event.nativeEvent.data);
    if (message?.type === 'ready') setReady(true);
    else if (message?.type === 'failed') onStyleFailed();
    else if (message?.type === 'gesture') setFollowing(false);
    else if (message?.type === 'select') overview?.onSelect(message.id);
  };

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setTilesSlow(true), TILE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  const fitRoute = useCallback(() => {
    const bounds = boundsOf(allPoints);
    if (!bounds) return;
    if (allPoints.length === 1) {
      send({ type: 'camera', kind: 'ease', center: toLngLat(allPoints[0]), zoom: MAP_FOLLOW_ZOOM, duration: 400 });
      return;
    }
    send({
      type: 'camera',
      kind: 'fit',
      bounds: [
        [bounds.minLongitude, bounds.minLatitude],
        [bounds.maxLongitude, bounds.maxLatitude],
      ],
      padding: FIT_PADDING,
      duration: 500,
    });
  }, [allPoints, send]);

  // An overview: following would pull the camera back to the current position on the next fix.
  const showWholeRoute = useCallback(() => {
    setFollowing(false);
    fitRoute();
  }, [fitRoute]);

  const recenter = useCallback(() => {
    setFollowing(true);
    if (currentPosition) {
      send({ type: 'camera', kind: 'ease', center: toLngLat(currentPosition), zoom: MAP_FOLLOW_ZOOM, duration: 400 });
    }
  }, [currentPosition, send]);

  useEffect(() => {
    if (ready && fitRouteOnReady) fitRoute();
    // Fit once when the map becomes ready, and again when the overview shows other routes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, overviewKey]);

  useEffect(() => {
    if (!ready || !following || !currentPosition) return;
    if (!centredOnce.current) {
      // First position (the map may have opened zoomed out): jump straight to street level.
      centredOnce.current = true;
      send({ type: 'camera', kind: 'jump', center: toLngLat(currentPosition), zoom: MAP_FOLLOW_ZOOM });
      return;
    }
    // Gestures and "show whole route" end following, so the zoom can only differ here right after
    // recenter; passing it keeps this animation from cancelling recenter's zoom to street level.
    send({ type: 'camera', kind: 'ease', center: toLngLat(currentPosition), zoom: MAP_FOLLOW_ZOOM, duration: 500 });
  }, [ready, following, currentPosition, send]);

  const routeShape = useMemo<Feature<MultiLineString> | FeatureCollection>(() => {
    const lines = geometry.lines.filter((line) => line.length > 1);
    if (lines.length === 0) return EMPTY;
    if (!hasBothParts(geometry)) {
      return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines.map((line) => line.map(toLngLat)) } };
    }
    // Walking and running parts in their own colours (the page colours lines by "kind").
    const byKind = new Map<string, LngLat[][]>();
    geometry.lines.forEach((line, index) => {
      if (line.length < 2) return;
      const kind = geometry.lineTypes[index] ?? 'route';
      byKind.set(kind, [...(byKind.get(kind) ?? []), line.map(toLngLat)]);
    });
    return {
      type: 'FeatureCollection',
      features: [...byKind].map(
        ([kind, coordinates]): Feature<MultiLineString> => ({
          type: 'Feature',
          properties: { kind },
          geometry: { type: 'MultiLineString', coordinates },
        }),
      ),
    };
  }, [geometry]);

  const overviewShape = useMemo<FeatureCollection<MultiLineString>>(
    () => ({
      type: 'FeatureCollection',
      features: (overviewRoutes ?? [])
        .map((route) => ({ route, lines: route.lines.filter((line) => line.length > 1) }))
        .filter(({ lines }) => lines.length > 0)
        .map(
          ({ route, lines }): Feature<MultiLineString> => ({
            type: 'Feature',
            properties: { id: route.id, kind: route.type },
            geometry: { type: 'MultiLineString', coordinates: lines.map((line) => line.map(pairToLngLat)) },
          }),
        ),
    }),
    [overviewRoutes],
  );

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

  // Each part is sent on its own, so a new GPS fix doesn't resend the whole route.
  useEffect(() => {
    if (ready) {
      send({ type: 'paint', color, walkColor: theme.walk, runColor: theme.run, replay: replaying, gapColor: theme.routeGap, surfaceColor: theme.surface });
    }
  }, [ready, color, replaying, theme.walk, theme.run, theme.routeGap, theme.surface, send]);

  useEffect(() => {
    if (ready && overviewRoutes) send({ type: 'shapes', shapes: { overview: overviewShape } });
  }, [ready, overviewRoutes, overviewShape, send]);

  useEffect(() => {
    if (ready && overviewRoutes) send({ type: 'select', id: selectedId });
  }, [ready, overviewRoutes, selectedId, send]);

  useEffect(() => {
    if (ready) send({ type: 'shapes', shapes: { route: routeShape, gaps: gapShape } });
  }, [ready, routeShape, gapShape, send]);

  useEffect(() => {
    if (ready) send({ type: 'shapes', shapes: { trail: trailShape } });
  }, [ready, trailShape, send]);

  useEffect(() => {
    if (ready) send({ type: 'shapes', shapes: { accuracy: accuracyShape, markers: markerShape } });
  }, [ready, accuracyShape, markerShape, send]);

  return (
    <View style={[styles.container, height ? { height } : styles.flex, { backgroundColor: theme.surfaceAlt }]}>
      <WebView
        ref={webViewRef}
        source={{ html: page, baseUrl: MAP_PAGE_BASE_URL }}
        originWhitelist={['*']}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={openLinksOutside}
        onError={onStyleFailed}
        onRenderProcessGone={onRendererGone}
        setSupportMultipleWindows={false}
        setBuiltInZoomControls={false}
        // Gestures on the map move the map, not the screen it sits in.
        nestedScrollEnabled
        overScrollMode="never"
        textZoom={100}
        webviewDebuggingEnabled={__DEV__}
        style={[styles.webView, { backgroundColor: theme.surfaceAlt }]}
        accessibilityLabel={overviewRoutes ? 'Map of all your routes' : 'Map of the recorded route'}
      />

      {!ready ? (
        <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: theme.surfaceAlt }]} pointerEvents="none">
          <AppText color="textSecondary">{tilesSlow ? 'Map needs an internet connection…' : 'Loading map…'}</AppText>
        </View>
      ) : null}

      <View style={styles.controls}>
        {currentPosition && (!following || !followCurrentPosition) ? (
          <MapButton icon="crosshairs-gps" label="Center on my position" onPress={recenter} />
        ) : null}
        {allPoints.length > 0 ? (
          <MapButton icon="fit-to-screen-outline" label={overviewRoutes ? 'Show all routes' : 'Show the whole route'} onPress={showWholeRoute} />
        ) : null}
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

function MapFallback({ geometry, fallbackPreview, overview, routeColor, height, replayPosition, reason }: RouteMapProps & { reason: string }) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const preview = useMemo<[number, number][][]>(() => {
    if (overview) return overview.routes.flatMap((route) => route.lines);
    return geometry.lines.some((line) => line.length > 1)
      ? geometry.lines.map((line) => line.map((point): [number, number] => [point.latitude, point.longitude]))
      : (fallbackPreview ?? []);
  }, [fallbackPreview, geometry, overview]);
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
  webView: { flex: 1 },
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
