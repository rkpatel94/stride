/**
 * Map tiles: OpenFreeMap (https://openfreemap.org) — free vector tiles built from OpenStreetMap
 * data, with no API key, registration or view limits. Rendered by MapLibre Native, which shows
 * the required "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" attribution automatically
 * (keep the attribution button enabled).
 *
 * To use another provider or a self-hosted style, change these URLs to any MapLibre style JSON.
 */
export const MAP_STYLE_URLS = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

/** Zoom used when centring on the current position (street level). */
export const MAP_FOLLOW_ZOOM = 16.5;
