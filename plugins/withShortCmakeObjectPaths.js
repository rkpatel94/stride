const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * React Native compiles every library's C++ codegen inside the app's CMake build. CMake encodes
 * the absolute source path into object file names, which exceeds Windows' 260-character limit
 * for projects in deep folders. CMake shortens such names with a hash once they pass
 * CMAKE_OBJECT_PATH_MAX, but for Android targets that limit defaults to ~1000, so it never kicks
 * in. Setting it explicitly is harmless on macOS/Linux and fixes Windows builds.
 */
const MARKER = '-DCMAKE_OBJECT_PATH_MAX=';

module.exports = function withShortCmakeObjectPaths(config) {
  return withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    if (contents.includes(MARKER)) return modConfig;
    modConfig.modResults.contents = contents.replace(
      /defaultConfig\s*\{/,
      (match) => `${match}
        // Added by plugins/withShortCmakeObjectPaths.js (Windows path-length limit).
        externalNativeBuild {
            cmake {
                arguments "${MARKER}250"
            }
        }`,
    );
    return modConfig;
  });
};
