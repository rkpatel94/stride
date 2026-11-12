import { buildMapPage, commandScript, parseMapPageMessage, type MapCommand, type MapPageConfig } from '@/components/map/mapPage';

const config: MapPageConfig = {
  styleUrl: 'https://tiles.example.org/styles/liberty',
  center: [13.4, 52.5],
  zoom: 16.5,
  background: '#101114',
  paint: { color: '#2EE6A8', walkColor: '#46C8FF', runColor: '#FF6B3D', replay: false, gapColor: '#888888', surfaceColor: '#15171C' },
};

const closingScriptTags = (page: string) => page.match(/<\/script>/gi)?.length ?? 0;

describe('map page', () => {
  it('is one self-contained page that loads no scripts from elsewhere', () => {
    const page = buildMapPage(config);
    // Config, MapLibre GL JS and the page script: nothing inside them may end its element early.
    expect(closingScriptTags(page)).toBe(3);
    expect(page).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(page).toContain('maplibregl');
  });

  it('embeds its configuration so that no value can close the script element', () => {
    const styleUrl = 'https://x.example/</script><script>alert(1)</script>';
    const page = buildMapPage({ ...config, styleUrl });
    expect(closingScriptTags(page)).toBe(3);
    const json = page.split('window.__STRIDE_MAP__ = ')[1].split(';</script>')[0];
    expect(JSON.parse(json)).toEqual({ ...config, styleUrl });
  });

  it('accepts only the messages the page sends', () => {
    expect(parseMapPageMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseMapPageMessage('{"type":"gesture"}')).toEqual({ type: 'gesture' });
    expect(parseMapPageMessage('{"type":"failed","reason":"offline"}')).toEqual({ type: 'failed', reason: 'offline' });
    expect(parseMapPageMessage('{"type":"failed"}')).toEqual({ type: 'failed', reason: 'unknown' });
    expect(parseMapPageMessage('{"type":"select","id":42}')).toEqual({ type: 'select', id: 42 });
    expect(parseMapPageMessage('{"type":"select","id":null}')).toEqual({ type: 'select', id: null });
    expect(parseMapPageMessage('{"type":"select","id":"42"}')).toEqual({ type: 'select', id: null });
    expect(parseMapPageMessage('{"type":"navigate"}')).toBeNull();
    expect(parseMapPageMessage('not json')).toBeNull();
  });

  it('can open fitted to a route instead of at a center and zoom', () => {
    const bounds = { box: [[13.39, 52.5], [13.41, 52.51]] as [[number, number], [number, number]], padding: { top: 48, right: 72, bottom: 48, left: 48 }, maxZoom: 16.5 };
    const page = buildMapPage({ ...config, bounds });
    const json = page.split('window.__STRIDE_MAP__ = ')[1].split(';</script>')[0];
    expect(JSON.parse(json).bounds).toEqual(bounds);
    expect(page).toContain('options.fitBoundsOptions');
  });

  it('sends commands as a call that does nothing until the page has defined it', () => {
    const command: MapCommand = { type: 'camera', kind: 'jump', center: [13.4, 52.5], zoom: 16.5 };
    expect(commandScript(command)).toBe(`window.strideMap && window.strideMap(${JSON.stringify(command)}); true;`);
  });
});
