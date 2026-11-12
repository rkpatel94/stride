/**
 * The faces the app uses, keyed by the family names in `Fonts` (theme.ts). The files are Latin
 * subsets of the Google Fonts releases made by scripts/subset-fonts.js (licences next to them in
 * assets/fonts/); Android draws any character they lack with the system font.
 */
export const FONT_ASSETS = {
  Unbounded_700Bold: require('../../assets/fonts/Unbounded_700Bold.ttf'),
  SpaceGrotesk_500Medium: require('../../assets/fonts/SpaceGrotesk_500Medium.ttf'),
  SpaceGrotesk_600SemiBold: require('../../assets/fonts/SpaceGrotesk_600SemiBold.ttf'),
  SpaceGrotesk_700Bold: require('../../assets/fonts/SpaceGrotesk_700Bold.ttf'),
  Inter_400Regular: require('../../assets/fonts/Inter_400Regular.ttf'),
  Inter_600SemiBold: require('../../assets/fonts/Inter_600SemiBold.ttf'),
  JetBrainsMono_500Medium: require('../../assets/fonts/JetBrainsMono_500Medium.ttf'),
  JetBrainsMono_700Bold: require('../../assets/fonts/JetBrainsMono_700Bold.ttf'),
};
