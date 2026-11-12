// metro.config.js resolves expo-router's optional `@expo/ui/jetpack-compose` and `expo-symbols`
// imports to this file. expo-router loads them inside a try/catch, only for Stack.Toolbar and
// native tabs on Android, which Stride doesn't use. Throwing makes expo-router treat them as not
// installed, so their code and the ~1 MB Material Symbols font they pull in stay out of the app.
// Remove the redirect before using Stack.Toolbar or NativeTabs.
throw new Error('This optional module is excluded from the app (see metro.config.js).');
