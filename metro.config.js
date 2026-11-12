// Learn more: https://docs.expo.dev/guides/customizing-metro/
const path = require('node:path');
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

// expo-router optionally loads Expo UI (Jetpack Compose) for Stack.Toolbar and expo-symbols for
// native tabs, neither of which this app uses; redirecting them keeps their code and the ~1 MB
// Material Symbols font they need out of the bundle (see the file).
const excludedModules = new Set(['@expo/ui/jetpack-compose', '@expo/ui/jetpack-compose/modifiers', 'expo-symbols']);
const excludedModulePath = path.join(__dirname, 'metro', 'unused-optional-module.js');
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (excludedModules.has(moduleName)) return { type: 'sourceFile', filePath: excludedModulePath };
  return upstreamResolveRequest
    ? upstreamResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
