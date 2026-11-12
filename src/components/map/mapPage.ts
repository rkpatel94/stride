import type { Feature, FeatureCollection } from 'geojson';

import { MAPLIBRE_GL_CSS, MAPLIBRE_GL_JS } from './vendor/maplibreGl';

/**
 * The HTML page behind RouteMap: MapLibre GL JS (shipped with the app, see vendor/) drawing the
 * same OpenFreeMap vector tiles as before, inside a WebView. Replacing MapLibre Native with it
 * removes a ~4 MB native library from the APK.
 *
 * React Native drives the page with `MapCommand`s (injected as `window.strideMap(command)`) and the
 * page answers with `MapPageMessage`s through `window.ReactNativeWebView.postMessage`.
 */

/** Origin the page runs under. `.invalid` never resolves, so nothing is ever requested from it. */
export const MAP_PAGE_BASE_URL = 'https://stride.invalid/';

export type LngLat = [number, number];

export type MapPaint = {
  /** Route colour; also used for lines without a walk/run part. */
  color: string;
  /** Colours of the walking and running parts (feature property `kind`). */
  walkColor: string;
  runColor: string;
  /** While replaying, the full route is dimmed under the replayed trail. */
  replay: boolean;
  gapColor: string;
  surfaceColor: string;
};

export type MapPageConfig = {
  styleUrl: string;
  center: LngLat | null;
  zoom: number;
  /** Open the map fitted to these bounds instead of at `center` and `zoom`. */
  bounds?: { box: [LngLat, LngLat]; padding: { top: number; right: number; bottom: number; left: number }; maxZoom: number };
  background: string;
  paint: MapPaint;
};

export type MapShapeId = 'route' | 'gaps' | 'trail' | 'accuracy' | 'markers' | 'overview';

export type MapCommand =
  | { type: 'shapes'; shapes: Partial<Record<MapShapeId, Feature | FeatureCollection>> }
  | ({ type: 'paint' } & MapPaint)
  /** Highlights one route of the overview (feature property `id`), or none. */
  | { type: 'select'; id: number | null }
  | { type: 'camera'; kind: 'jump'; center: LngLat; zoom: number }
  | { type: 'camera'; kind: 'ease'; center: LngLat; zoom: number; duration: number }
  | {
      type: 'camera';
      kind: 'fit';
      bounds: [LngLat, LngLat];
      padding: { top: number; right: number; bottom: number; left: number };
      duration: number;
    };

export type MapPageMessage =
  /** The style is loaded and the route layers exist: commands can be sent. */
  | { type: 'ready' }
  /** The map cannot be shown (style unreachable, e.g. offline, or no WebGL). */
  | { type: 'failed'; reason: string }
  /** The user panned, zoomed or rotated the map. */
  | { type: 'gesture' }
  /** The user tapped a route of the overview (its id), or the map away from every route (null). */
  | { type: 'select'; id: number | null };

export function parseMapPageMessage(data: string): MapPageMessage | null {
  try {
    const message = JSON.parse(data) as { type?: unknown; reason?: unknown; id?: unknown };
    if (message.type === 'ready' || message.type === 'gesture') return { type: message.type };
    if (message.type === 'select') {
      return { type: 'select', id: typeof message.id === 'number' && Number.isFinite(message.id) ? message.id : null };
    }
    if (message.type === 'failed') return { type: 'failed', reason: typeof message.reason === 'string' ? message.reason : 'unknown' };
  } catch {
    // Not one of ours.
  }
  return null;
}

/** JavaScript passed to WebView.injectJavaScript for one command. */
export function commandScript(command: MapCommand): string {
  return `window.strideMap && window.strideMap(${JSON.stringify(command)}); true;`;
}

const PAGE_CSS = 'html,body,#map{margin:0;padding:0;width:100%;height:100%;overflow:hidden}';

// Runs inside the WebView. Plain JavaScript: it is shipped as text, not compiled by Metro.
const PAGE_SCRIPT = `
(function () {
  'use strict';
  var init = window.__STRIDE_MAP__;
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var ROUND = { 'line-cap': 'round', 'line-join': 'round' };
  var map = null;
  var loaded = false;
  var failed = false;
  var overviewShown = false;

  function send(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function fail(reason) {
    if (failed || loaded) return;
    failed = true;
    send({ type: 'failed', reason: String(reason || 'unknown') });
  }

  window.addEventListener('error', function (event) { fail(event.message); });
  document.body.style.background = init.background;

  // Lines with a walk/run part use that part's colour, others the route colour.
  function byKind(paint, fallback) {
    return ['match', ['to-string', ['get', 'kind']], 'walk', paint.walkColor, 'run', paint.runColor, fallback];
  }

  function addLayers() {
    ['overview', 'route', 'gaps', 'trail', 'accuracy', 'markers'].forEach(function (id) {
      map.addSource(id, { type: 'geojson', data: EMPTY });
    });
    // All routes at once: thin lines, the tapped one drawn wider on top.
    map.addLayer({ id: 'overview-line', type: 'line', source: 'overview', layout: ROUND, paint: { 'line-width': 3, 'line-opacity': 0.7 } });
    map.addLayer({
      id: 'overview-selected-glow',
      type: 'line',
      source: 'overview',
      layout: ROUND,
      filter: ['==', ['get', 'id'], -1],
      paint: { 'line-width': 14, 'line-blur': 6, 'line-opacity': 0.35 }
    });
    map.addLayer({
      id: 'overview-selected',
      type: 'line',
      source: 'overview',
      layout: ROUND,
      filter: ['==', ['get', 'id'], -1],
      paint: { 'line-width': 6 }
    });
    map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: ROUND, paint: { 'line-width': 16, 'line-blur': 8 } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: ROUND, paint: { 'line-width': 6 } });
    map.addLayer({ id: 'gap-line', type: 'line', source: 'gaps', paint: { 'line-width': 3, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', layout: ROUND, paint: { 'line-width': 6 } });
    map.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-opacity': 0.14 } });
    map.addLayer({ id: 'accuracy-outline', type: 'line', source: 'accuracy', paint: { 'line-width': 1, 'line-opacity': 0.5 } });
    map.addLayer({
      id: 'marker-glow',
      type: 'circle',
      source: 'markers',
      filter: ['match', ['get', 'role'], ['position', 'replay'], true, false],
      paint: { 'circle-radius': 20, 'circle-opacity': 0.3, 'circle-blur': 0.9 }
    });
    // Start is a hollow ring; finish and the live or replayed position are solid dots.
    map.addLayer({
      id: 'marker-dots',
      type: 'circle',
      source: 'markers',
      paint: { 'circle-radius': ['match', ['get', 'role'], 'position', 9, 'replay', 9, 'start', 6, 7], 'circle-stroke-width': 3 }
    });
  }

  var handlers = {
    shapes: function (command) {
      Object.keys(command.shapes).forEach(function (id) {
        var data = command.shapes[id] || EMPTY;
        if (id === 'overview') overviewShown = Boolean(data.features && data.features.length > 0);
        map.getSource(id).setData(data);
      });
    },
    paint: function (paint) {
      var color = paint.color;
      var lineColor = byKind(paint, color);
      map.setPaintProperty('overview-line', 'line-color', lineColor);
      map.setPaintProperty('overview-selected-glow', 'line-color', lineColor);
      map.setPaintProperty('overview-selected', 'line-color', lineColor);
      map.setPaintProperty('route-glow', 'line-color', lineColor);
      map.setPaintProperty('route-glow', 'line-opacity', paint.replay ? 0.08 : 0.25);
      map.setPaintProperty('route-line', 'line-color', lineColor);
      map.setPaintProperty('route-line', 'line-opacity', paint.replay ? 0.4 : 1);
      map.setPaintProperty('gap-line', 'line-color', paint.gapColor);
      map.setPaintProperty('trail-line', 'line-color', color);
      map.setPaintProperty('accuracy-fill', 'fill-color', color);
      map.setPaintProperty('accuracy-outline', 'line-color', color);
      map.setPaintProperty('marker-glow', 'circle-color', color);
      map.setPaintProperty('marker-dots', 'circle-color', ['match', ['get', 'role'], 'start', paint.surfaceColor, color]);
      map.setPaintProperty('marker-dots', 'circle-stroke-color', ['match', ['get', 'role'], 'start', color, '#FFFFFF']);
    },
    select: function (command) {
      var filter = ['==', ['get', 'id'], command.id === null ? -1 : command.id];
      map.setFilter('overview-selected-glow', filter);
      map.setFilter('overview-selected', filter);
    },
    camera: function (command) {
      if (command.kind === 'jump') map.jumpTo({ center: command.center, zoom: command.zoom });
      else if (command.kind === 'ease') map.easeTo({ center: command.center, zoom: command.zoom, duration: command.duration });
      else if (command.kind === 'fit') map.fitBounds(command.bounds, { padding: command.padding, duration: command.duration });
    }
  };

  window.strideMap = function (command) {
    var handler = loaded && handlers[command.type];
    if (handler) handler(command);
  };

  function start(style) {
    var options = {
      container: 'map',
      style: style,
      attributionControl: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0
    };
    if (init.bounds) {
      options.bounds = init.bounds.box;
      options.fitBoundsOptions = { padding: init.bounds.padding, maxZoom: init.bounds.maxZoom };
    } else {
      options.center = init.center || [0, 0];
      options.zoom = init.zoom;
    }
    try {
      map = new maplibregl.Map(options);
    } catch (error) {
      fail(error && error.message);
      return;
    }
    // The tile and data licences require the attribution; it stays visible behind the (i) button.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-left');
    map.on('load', function () {
      addLayers();
      handlers.paint(init.paint);
      loaded = true;
      send({ type: 'ready' });
    });
    map.on('movestart', function (event) {
      if (event.originalEvent) send({ type: 'gesture' });
    });
    // A tap selects the topmost overview route within a finger's width; a tap elsewhere clears it.
    map.on('click', function (event) {
      if (!overviewShown) return;
      var p = event.point;
      var hits = map.queryRenderedFeatures([[p.x - 14, p.y - 14], [p.x + 14, p.y + 14]], { layers: ['overview-line'] });
      send({ type: 'select', id: hits.length > 0 ? hits[0].properties.id : null });
    });
  }

  // The style is fetched here so that only an unreachable style (offline, server down) counts as
  // a failure; individual tiles that fail later just stay blank.
  fetch(init.styleUrl)
    .then(function (response) {
      if (!response.ok) throw new Error('Map style request failed (' + response.status + ')');
      return response.json();
    })
    .then(start, function (error) { fail(error && error.message); });
})();
`;

/** A complete, self-contained page for one map instance. */
export function buildMapPage(config: MapPageConfig): string {
  // Embedded in a <script> element: "<" is escaped so no value can close it.
  const json = JSON.stringify(config).split('<').join('\\u003c');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    `<style>${MAPLIBRE_GL_CSS}${PAGE_CSS}</style></head><body><div id="map"></div>`,
    `<script>window.__STRIDE_MAP__ = ${json};</script>`,
    `<script>${MAPLIBRE_GL_JS}</script>`,
    `<script>${PAGE_SCRIPT}</script>`,
    '</body></html>',
  ].join('');
}
