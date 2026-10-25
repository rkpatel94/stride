// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Gradle builds every native library in place (node_modules/*/android/build, .cxx, .gradle):
// tens of thousands of binaries that never contain JavaScript. Expo already skips the app's
// own android/app/build; skipping the rest keeps Metro's file crawl fast after native builds.
const nativeBuildOutputs = /(?:^|[\\/])android[\\/](?:app[\\/])?(?:build|\.cxx|\.gradle)(?:[\\/]|$)/;

const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  nativeBuildOutputs,
];

module.exports = config;
