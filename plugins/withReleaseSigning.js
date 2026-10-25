const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Release signing without committing secrets. The keystore path and passwords are read from
 * Gradle properties, normally defined in the user-level ~/.gradle/gradle.properties:
 *
 *   STRIDE_UPLOAD_STORE_FILE=C:/keys/stride-upload.jks
 *   STRIDE_UPLOAD_STORE_PASSWORD=...
 *   STRIDE_UPLOAD_KEY_ALIAS=stride
 *   STRIDE_UPLOAD_KEY_PASSWORD=...
 *
 * Without them, release builds fall back to the debug key (fine for local testing, not for
 * distribution) and Gradle prints a warning.
 */
const MARKER = 'STRIDE_UPLOAD_STORE_FILE';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (contents.includes(MARKER)) return modConfig;

    contents = contents.replace(
      /signingConfigs\s*\{/,
      (match) => `${match}
        release {
            // Added by plugins/withReleaseSigning.js — values live outside the repository.
            if (project.hasProperty('${MARKER}')) {
                storeFile file(project.property('${MARKER}'))
                storePassword project.property('STRIDE_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('STRIDE_UPLOAD_KEY_ALIAS')
                keyPassword project.property('STRIDE_UPLOAD_KEY_PASSWORD')
            }
        }`,
    );

    const buildTypesStart = contents.indexOf('buildTypes {');
    const releaseStart = contents.indexOf('release {', buildTypesStart);
    const debugSigning = 'signingConfig signingConfigs.debug';
    const signingIndex = contents.indexOf(debugSigning, releaseStart);
    if (buildTypesStart === -1 || releaseStart === -1 || signingIndex === -1) {
      throw new Error('withReleaseSigning: could not find the release build type in app/build.gradle');
    }
    const replacement = `if (project.hasProperty('${MARKER}')) {
                signingConfig signingConfigs.release
            } else {
                logger.warn('Release build signed with the DEBUG key: set ${MARKER} (see README).')
                signingConfig signingConfigs.debug
            }`;
    contents = contents.slice(0, signingIndex) + replacement + contents.slice(signingIndex + debugSigning.length);
    modConfig.modResults.contents = contents;
    return modConfig;
  });
};
