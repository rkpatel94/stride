import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/Feedback';
import { FONT_ASSETS } from '@/constants/fonts';
import { Fonts, Spacing } from '@/constants/theme';
import { bootstrapApp } from '@/features/app/bootstrap';
import { useTheme } from '@/hooks/use-theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const theme = useTheme();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  // A font that fails to load falls back to the system font; it never blocks the app.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const fontsSettled = fontsLoaded || fontError !== null;

  const load = useCallback(() => {
    bootstrapApp()
      .then(() => setStatus('ready'))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus('error');
      });
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (status !== 'loading' && fontsSettled) void SplashScreen.hideAsync().catch(() => undefined);
  }, [status, fontsSettled]);

  const retry = () => {
    setStatus('loading');
    load();
  };

  const navigationTheme = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;

  if (!fontsSettled) return null; // The splash screen is still showing.

  if (status !== 'ready') {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
        {status === 'loading' ? (
          <LoadingState label="Opening your activity log…" />
        ) : (
          <View style={styles.error}>
            <AppText variant="title">Could not open your data</AppText>
            <AppText color="textSecondary">
              {error} Your recorded activities have not been deleted. Try again, and if this keeps happening, export a
              backup from Settings once the app opens.
            </AppText>
            <Button label="Try again" icon="refresh" onPress={retry} />
          </View>
        )}
      </View>
    );
  }

  return (
    <ThemeProvider
      value={{
        ...navigationTheme,
        colors: {
          ...navigationTheme.colors,
          primary: theme.accent,
          background: theme.background,
          card: theme.background,
          text: theme.text,
          border: theme.border,
        },
      }}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: { fontFamily: Fonts.number[600], fontSize: 19 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="activity/[id]" options={{ title: 'Activity' }} />
        <Stack.Screen name="goals" options={{ title: 'Goals & achievements' }} />
        <Stack.Screen name="diagnostics" options={{ title: 'Diagnostics' }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  error: { padding: Spacing.xl, gap: Spacing.lg },
});
