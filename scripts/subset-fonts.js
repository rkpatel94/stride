#!/usr/bin/env node
/**
 * Writes Latin-only subsets of the app's fonts to assets/fonts/ (loaded by
 * src/constants/fonts.ts), with each family's SIL Open Font License next to them. The Google Fonts
 * releases also cover Cyrillic, Greek and Vietnamese; Stride's UI is English, and Android draws any
 * character a subset lacks with the system font. This keeps ~0.5 MB of glyphs out of the APK.
 *
 * Needs Python 3 with fontTools (`pip install fonttools`). Run it after changing the font set:
 *
 *   npm run fonts:subset
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'assets', 'fonts');
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

// Google Fonts package -> the faces in FONT_ASSETS (src/constants/fonts.ts).
const FONTS = {
  inter: ['400Regular/Inter_400Regular', '600SemiBold/Inter_600SemiBold'],
  'jetbrains-mono': ['500Medium/JetBrainsMono_500Medium', '700Bold/JetBrainsMono_700Bold'],
  'space-grotesk': ['500Medium/SpaceGrotesk_500Medium', '600SemiBold/SpaceGrotesk_600SemiBold', '700Bold/SpaceGrotesk_700Bold'],
  unbounded: ['700Bold/Unbounded_700Bold'],
};

// Google Fonts' "latin" subset, plus the symbols the UI uses: arrows, minus, <= and >=, triangles.
const UNICODES = [
  'U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC', 'U+0304', 'U+0308',
  'U+0329', 'U+2000-206F', 'U+2074', 'U+20AC', 'U+2122', 'U+2190-2193', 'U+2212', 'U+2215', 'U+2264-2265',
  'U+25B2', 'U+25BC', 'U+FEFF', 'U+FFFD',
].join(',');

fs.mkdirSync(outDir, { recursive: true });
for (const [family, faces] of Object.entries(FONTS)) {
  const packageDir = path.join(root, 'node_modules', '@expo-google-fonts', family);
  for (const face of faces) {
    const source = path.join(packageDir, `${face}.ttf`);
    const target = path.join(outDir, `${path.basename(face)}.ttf`);
    try {
      execFileSync(
        python,
        // All OpenType features are kept: the number styles use tabular figures ('tnum').
        ['-m', 'fontTools.subset', source, `--unicodes=${UNICODES}`, '--layout-features=*', '--name-IDs=*', `--output-file=${target}`],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
    } catch (error) {
      console.error(`Could not subset ${face}. Install Python 3 and fontTools: pip install fonttools`);
      throw error;
    }
    const before = fs.statSync(source).size;
    const after = fs.statSync(target).size;
    console.log(`${path.basename(target)}: ${Math.round(before / 1000)} KB -> ${Math.round(after / 1000)} KB`);
  }
  fs.copyFileSync(path.join(packageDir, 'LICENSE_FONT'), path.join(outDir, `${family}-OFL.txt`));
}
