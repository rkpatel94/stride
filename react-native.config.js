// expo-router installs react-native-reanimated, react-native-worklets and
// react-native-gesture-handler as its own dependencies (for its drawer and the optional JS stack,
// `expo-router/js-stack`). This app uses native stacks and native tabs only, so their native code
// is excluded from the build. That removes several large C++ builds (whose object paths also
// exceed Windows' 260-character limit in deep folders) and keeps the APK smaller.
//
// If a future screen imports Reanimated, Gesture Handler or the JS stack, delete the matching
// entry below and rebuild the app; otherwise it will fail at runtime with a missing native module.
module.exports = {
  dependencies: {
    'react-native-reanimated': { platforms: { android: null, ios: null } },
    'react-native-worklets': { platforms: { android: null, ios: null } },
    'react-native-gesture-handler': { platforms: { android: null, ios: null } },
  },
};
