#!/usr/bin/env node
/**
 * Generates the app icon, adaptive icon layers and splash image as PNGs without any
 * dependencies (a tiny rasteriser + PNG encoder). Run: node scripts/generate-icons.js
 *
 * Motif: a winding route line that starts at a small dot and ends at a larger location dot.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'assets', 'images');
const GREEN = [14, 94, 74]; // #0E5E4A
const WHITE = [255, 255, 255];

// Route in unit coordinates (0..1) of the symbol box.
const ROUTE = [
  [0.2, 0.8],
  [0.42, 0.66],
  [0.3, 0.47],
  [0.56, 0.36],
  [0.74, 0.24],
];
const STROKE = 0.085;
const START_DOT = { center: ROUTE[0], radius: 0.075 };
const END_DOT = { center: ROUTE[ROUTE.length - 1], radius: 0.12 };

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True when the unit-space point is inside the symbol. */
function insideSymbol(x, y) {
  if (Math.hypot(x - END_DOT.center[0], y - END_DOT.center[1]) <= END_DOT.radius) {
    // Hollow centre in the end dot, like a map pin.
    return Math.hypot(x - END_DOT.center[0], y - END_DOT.center[1]) >= END_DOT.radius * 0.42;
  }
  if (Math.hypot(x - START_DOT.center[0], y - START_DOT.center[1]) <= START_DOT.radius) return true;
  for (let i = 0; i < ROUTE.length - 1; i += 1) {
    if (distanceToSegment(x, y, ROUTE[i], ROUTE[i + 1]) <= STROKE / 2) return true;
  }
  return false;
}

/**
 * Renders an RGBA image. `symbolBox` is the square region (in pixels) the symbol occupies.
 * `background` null = transparent.
 */
function render(size, { background, symbolColor, symbolBox, cornerRadius = 0 }) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let symbolCoverage = 0;
      let shapeCoverage = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          if (insideRoundedSquare(x, y, size, cornerRadius)) shapeCoverage += 1;
          const ux = (x - symbolBox.x) / symbolBox.size;
          const uy = (y - symbolBox.y) / symbolBox.size;
          if (ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1 && insideSymbol(ux, uy)) symbolCoverage += 1;
        }
      }
      const total = samples * samples;
      const symbolAlpha = symbolCoverage / total;
      const shapeAlpha = background ? shapeCoverage / total : 0;
      const alpha = symbolAlpha + shapeAlpha * (1 - symbolAlpha);
      const offset = (py * size + px) * 4;
      for (let c = 0; c < 3; c += 1) {
        const bg = background ? background[c] : 0;
        const value = alpha > 0 ? (symbolColor[c] * symbolAlpha + bg * shapeAlpha * (1 - symbolAlpha)) / alpha : 0;
        pixels[offset + c] = Math.round(value);
      }
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

function insideRoundedSquare(x, y, size, radius) {
  if (radius <= 0) return true;
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

// --- PNG encoding ----------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, size, options) {
  fs.writeFileSync(path.join(OUT, name), encodePng(size, render(size, options)));
  console.log(`wrote ${name}`);
}

const SIZE = 1024;
// Adaptive icons: keep the symbol inside the central safe zone (~61 % of the canvas).
const safe = { x: SIZE * 0.25, y: SIZE * 0.25, size: SIZE * 0.5 };

write('icon.png', SIZE, { background: GREEN, symbolColor: WHITE, symbolBox: { x: SIZE * 0.18, y: SIZE * 0.18, size: SIZE * 0.64 }, cornerRadius: SIZE * 0.22 });
write('android-icon-foreground.png', SIZE, { background: null, symbolColor: WHITE, symbolBox: safe });
write('android-icon-background.png', SIZE, { background: GREEN, symbolColor: GREEN, symbolBox: { x: 0, y: 0, size: 0 } });
write('android-icon-monochrome.png', SIZE, { background: null, symbolColor: WHITE, symbolBox: safe });
write('splash-icon.png', 512, { background: null, symbolColor: WHITE, symbolBox: { x: 32, y: 32, size: 448 } });
