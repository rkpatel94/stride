const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Stride's UI is English-only, but AndroidX, Material and Google Play services bring translations
 * for dozens of languages. They all end up in resources.arsc, which Android requires to be stored
 * uncompressed, so they cost about 1 MB of APK size for nothing. This keeps English resources only.
 * Remove the plugin if the app is ever translated.
 */
const MARKER = 'withEnglishOnlyResources';

module.exports = function withEnglishOnlyResources(config) {
  return withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    if (contents.includes(MARKER)) return modConfig;
    const androidBlock = /^android\s*\{/m;
    if (!androidBlock.test(contents)) {
      throw new Error('withEnglishOnlyResources: could not find the android { } block in app/build.gradle');
    }
    modConfig.modResults.contents = contents.replace(
      androidBlock,
      (match) => `${match}
    // Added by plugins/${MARKER}.js: the app is English-only, so library translations are dropped.
    androidResources {
        localeFilters.add("en")
    }
`,
    );
    return modConfig;
  });
};
